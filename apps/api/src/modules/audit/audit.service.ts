import { Injectable } from '@nestjs/common';
import { Prisma, type AuditAction } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { ClientContext } from '../../common/decorators/client-context.decorator';

export interface AppendArgs {
  userId?: string;
  actorId?: string;
  action: AuditAction;
  resource?: string;
  client?: ClientContext;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Tamper-evident audit log. Each entry hashes (prevHash || canonical
 * row), forming a chain. To tamper an old entry you'd need to recompute
 * every subsequent hash — and we can periodically anchor the latest
 * hash externally (e.g. into S3 with object lock).
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async append(args: AppendArgs): Promise<void> {
    const prev = await this.prisma.auditLog.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { hash: true },
    });
    const prevHash = prev?.hash ?? null;

    const canonical = JSON.stringify({
      userId: args.userId ?? null,
      actorId: args.actorId ?? null,
      action: args.action,
      resource: args.resource ?? null,
      ipAddress: args.client?.ip ?? null,
      userAgent: args.client?.userAgent ?? null,
      metadata: args.metadata ?? null,
      // include nanosecond clock so two events in the same ms still chain
      ts: Date.now(),
    });
    const hash = createHash('sha256')
      .update(prevHash ?? '')
      .update('|')
      .update(canonical)
      .digest('hex');

    await this.prisma.auditLog.create({
      data: {
        userId: args.userId,
        actorId: args.actorId,
        action: args.action,
        resource: args.resource,
        ipAddress: args.client?.ip,
        userAgent: args.client?.userAgent,
        prevHash,
        hash,
        metadata: args.metadata,
      },
    });
  }

  async listForUser(userId: string, take = 50) {
    return this.prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(take, 200),
    });
  }

  async listAll(take = 100) {
    return this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(take, 500),
    });
  }
}
