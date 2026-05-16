import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        role: true,
        status: true,
        storageQuotaBytes: true,
        storageUsedBytes: true,
        loginAlertsEnabled: true,
        createdAt: true,
        twoFactor: { select: { enabled: true } },
      },
    });
    if (!user) throw new NotFoundException();
    return user;
  }

  async updateProfile(userId: string, patch: { displayName?: string; avatarUrl?: string }) {
    const data: { displayName?: string; avatarUrl?: string } = {};
    if (patch.displayName !== undefined) data.displayName = patch.displayName.slice(0, 80);
    if (patch.avatarUrl !== undefined) data.avatarUrl = patch.avatarUrl;
    return this.prisma.user.update({ where: { id: userId }, data });
  }

  async setLoginAlerts(userId: string, enabled: boolean) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { loginAlertsEnabled: enabled },
    });
  }

  /**
   * Throws if writing `delta` bytes would exceed the user's quota.
   * Used by upload flow + share-link copy.
   */
  async assertQuotaAllows(userId: string, deltaBytes: bigint) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { storageQuotaBytes: true, storageUsedBytes: true },
    });
    const quota = u.storageQuotaBytes ?? null;
    if (quota === null) return;
    if (u.storageUsedBytes + deltaBytes > quota) {
      throw new ForbiddenException({
        code: 'QUOTA_EXCEEDED',
        message: 'Storage quota would be exceeded',
      });
    }
  }

  async addUsage(userId: string, deltaBytes: bigint) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { storageUsedBytes: { increment: deltaBytes } },
    });
  }

  async subtractUsage(userId: string, deltaBytes: bigint) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        storageUsedBytes: { decrement: deltaBytes < 0n ? -deltaBytes : deltaBytes },
      },
    });
  }
}
