import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, FileStatus, Prisma, type File } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isSafeName } from '../../common/utils/path-safety';
import { UsersService } from '../users/users.service';
import { FoldersService } from '../folders/folders.service';
import { AuditService } from '../audit/audit.service';

export interface ListFilesArgs {
  ownerId: string;
  folderId?: string | null;
  search?: string;
  favorites?: boolean;
  sortBy?: 'name' | 'createdAt' | 'updatedAt' | 'sizeBytes';
  sortDir?: 'asc' | 'desc';
  take?: number;
  cursor?: string;
}

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly folders: FoldersService,
    private readonly audit: AuditService,
  ) {}

  async list(args: ListFilesArgs) {
    const take = Math.min(args.take ?? 50, 200);
    const where: Prisma.FileWhereInput = {
      ownerId: args.ownerId,
      deletedAt: null,
      status: { in: [FileStatus.CLEAN, FileStatus.QUARANTINED, FileStatus.SCANNING] },
      ...(args.folderId === null
        ? { folderId: null }
        : args.folderId
          ? { folderId: args.folderId }
          : {}),
      ...(args.favorites ? { isFavorite: true } : {}),
      ...(args.search
        ? {
            OR: [
              { name: { contains: args.search, mode: 'insensitive' } },
              { tags: { has: args.search.toLowerCase() } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.FileOrderByWithRelationInput = {
      [args.sortBy ?? 'createdAt']: args.sortDir ?? 'desc',
    };
    const items = await this.prisma.file.findMany({
      where,
      orderBy,
      take: take + 1,
      ...(args.cursor ? { skip: 1, cursor: { id: args.cursor } } : {}),
    });
    let nextCursor: string | null = null;
    if (items.length > take) {
      const last = items.pop();
      nextCursor = last?.id ?? null;
    }
    return {
      items: items.map(this.serialise.bind(this)),
      nextCursor,
    };
  }

  async getById(userId: string, id: string) {
    const file = await this.prisma.file.findUnique({
      where: { id },
      include: { folder: true, scans: { orderBy: { scannedAt: 'desc' }, take: 1 } },
    });
    if (!file || file.deletedAt) throw new NotFoundException();
    if (file.ownerId !== userId) {
      throw new ForbiddenException({ code: 'NOT_OWNER', message: 'Not authorized' });
    }
    return file;
  }

  async rename(userId: string, id: string, newName: string) {
    if (!isSafeName(newName)) {
      throw new BadRequestException({ code: 'INVALID_NAME', message: 'Invalid filename' });
    }
    const file = await this.getById(userId, id);
    return this.prisma.file.update({
      where: { id: file.id },
      data: { name: newName },
    });
  }

  async move(userId: string, id: string, folderId: string | null) {
    const file = await this.getById(userId, id);
    if (folderId) {
      await this.folders.requireOwned(folderId, userId);
    }
    return this.prisma.file.update({
      where: { id: file.id },
      data: { folderId },
    });
  }

  async toggleFavorite(userId: string, id: string, favorite: boolean) {
    const file = await this.getById(userId, id);
    return this.prisma.file.update({
      where: { id: file.id },
      data: { isFavorite: favorite },
    });
  }

  async updateTags(userId: string, id: string, tags: string[]) {
    const file = await this.getById(userId, id);
    const cleaned = Array.from(
      new Set(tags.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0 && t.length <= 64)),
    ).slice(0, 32);
    return this.prisma.file.update({
      where: { id: file.id },
      data: { tags: cleaned },
    });
  }

  async softDelete(userId: string, id: string, opts: { purgeAfterDays: number }) {
    const file = await this.getById(userId, id);
    const purgeAt = new Date(Date.now() + opts.purgeAfterDays * 86400 * 1000);
    const ancestorPath = file.folderId ?? 'root';
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.file.update({
        where: { id: file.id },
        data: { deletedAt: new Date(), status: FileStatus.DELETED },
      });
      await tx.recycleBinEntry.create({
        data: {
          userId,
          fileId: file.id,
          originalPath: ancestorPath,
          purgeAt,
        },
      });
      await this.audit.append({
        userId,
        action: AuditAction.FILE_DELETED,
        resource: `file:${file.id}`,
      });
      return updated;
    });
  }

  /** Hard-delete used by the recycle-bin purge job. */
  async hardDelete(file: File, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    await client.file.delete({ where: { id: file.id } });
    await this.users.subtractUsage(file.ownerId, file.sizeBytes);
  }

  serialise(file: File) {
    return {
      ...file,
      sizeBytes: file.sizeBytes.toString(),
    };
  }
}
