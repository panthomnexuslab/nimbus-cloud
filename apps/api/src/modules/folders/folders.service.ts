import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, type Folder, type Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isSafeName } from '../../common/utils/path-safety';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class FoldersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, parentId: string | null) {
    return this.prisma.folder.findMany({
      where: { ownerId: userId, parentId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  async create(userId: string, name: string, parentId: string | null) {
    if (!isSafeName(name)) {
      throw new BadRequestException({ code: 'INVALID_NAME', message: 'Invalid folder name' });
    }
    let pathIds = '/';
    if (parentId) {
      const parent = await this.requireOwned(parentId, userId);
      pathIds = `${parent.pathIds}${parent.id}/`;
    }
    try {
      const folder = await this.prisma.folder.create({
        data: {
          ownerId: userId,
          name,
          parentId,
          pathIds,
        },
      });
      await this.audit.append({
        userId,
        action: AuditAction.FOLDER_CREATED,
        resource: `folder:${folder.id}`,
      });
      return folder;
    } catch (e: unknown) {
      if (this.isUniqueViolation(e)) {
        throw new BadRequestException({
          code: 'DUPLICATE_NAME',
          message: 'A folder with this name already exists here',
        });
      }
      throw e;
    }
  }

  async rename(userId: string, id: string, newName: string) {
    if (!isSafeName(newName)) {
      throw new BadRequestException({ code: 'INVALID_NAME', message: 'Invalid folder name' });
    }
    const folder = await this.requireOwned(id, userId);
    return this.prisma.folder.update({
      where: { id: folder.id },
      data: { name: newName },
    });
  }

  async move(userId: string, id: string, newParentId: string | null) {
    const folder = await this.requireOwned(id, userId);
    if (newParentId === id) {
      throw new BadRequestException({ code: 'INVALID_MOVE', message: 'Cannot move into itself' });
    }
    let newPath = '/';
    if (newParentId) {
      const newParent = await this.requireOwned(newParentId, userId);
      // Prevent cycles: a child cannot become an ancestor's parent
      if (`${newParent.pathIds}${newParent.id}/`.includes(`/${folder.id}/`)) {
        throw new BadRequestException({
          code: 'INVALID_MOVE',
          message: 'Cannot move folder into one of its descendants',
        });
      }
      newPath = `${newParent.pathIds}${newParent.id}/`;
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.folder.update({
        where: { id: folder.id },
        data: { parentId: newParentId, pathIds: newPath },
      });
      // Re-stamp descendant paths.
      const descendants = await tx.folder.findMany({
        where: { ownerId: userId, pathIds: { startsWith: `${folder.pathIds}${folder.id}/` } },
      });
      for (const d of descendants) {
        const suffix = d.pathIds.slice(folder.pathIds.length);
        await tx.folder.update({
          where: { id: d.id },
          data: { pathIds: `${newPath}${suffix}` },
        });
      }
      return updated;
    });
  }

  async softDelete(userId: string, id: string) {
    const folder = await this.requireOwned(id, userId);
    return this.prisma.folder.update({
      where: { id: folder.id },
      data: { deletedAt: new Date() },
    });
  }

  async toggleFavorite(userId: string, id: string, favorite: boolean) {
    const folder = await this.requireOwned(id, userId);
    return this.prisma.folder.update({
      where: { id: folder.id },
      data: { isFavorite: favorite },
    });
  }

  async requireOwned(id: string, userId: string): Promise<Folder> {
    const folder = await this.prisma.folder.findUnique({ where: { id } });
    if (!folder || folder.deletedAt) throw new NotFoundException();
    if (folder.ownerId !== userId) {
      throw new ForbiddenException({ code: 'NOT_OWNER', message: 'Not authorized' });
    }
    return folder;
  }

  private isUniqueViolation(e: unknown): boolean {
    return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
  }
}
