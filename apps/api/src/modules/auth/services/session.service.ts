import { Injectable } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppConfigService } from '../../../config/app-config.service';
import type { ClientContext } from '../../../common/decorators/client-context.decorator';

export interface CreateSessionInput {
  userId: string;
  client: ClientContext;
  mfaSatisfied: boolean;
  rememberDevice?: boolean;
  deviceName?: string;
}

/**
 * Owns the lifecycle of `Session` + `TrustedDevice` rows. Sessions are
 * scoped to (user, device-fingerprint, IP-cluster) so revoking one
 * device doesn't kill them all.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: AppConfigService,
  ) {}

  async create(input: CreateSessionInput, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    const sessionId = randomUUID();
    const sessionTokenHash = this.hash(sessionId);

    const fp = input.client.fingerprint ?? `${input.client.ip}|${input.client.userAgent}`;
    const fpHash = createHash('sha256').update(fp).digest('hex');

    const device = await client.trustedDevice.upsert({
      where: { userId_fingerprintHash: { userId: input.userId, fingerprintHash: fpHash } },
      create: {
        userId: input.userId,
        name: input.deviceName ?? this.deriveName(input.client),
        platform: input.client.os ?? null,
        browser: input.client.browser ?? null,
        fingerprintHash: fpHash,
        trustedAt: input.rememberDevice ? new Date() : null,
      },
      update: {
        lastSeenAt: new Date(),
        ...(input.rememberDevice ? { trustedAt: new Date() } : {}),
        revokedAt: null,
      },
    });

    const session = await client.session.create({
      data: {
        id: sessionId,
        userId: input.userId,
        sessionTokenHash,
        deviceId: device.id,
        ipAddress: input.client.ip,
        userAgent: input.client.userAgent,
        fingerprint: fpHash,
        mfaSatisfied: input.mfaSatisfied,
        expiresAt: new Date(Date.now() + this.cfg.jwtRefreshTtl * 1000),
      },
    });

    return { session, device };
  }

  async findActive(sessionId: string) {
    return this.prisma.session.findFirst({
      where: { id: sessionId, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { device: true },
    });
  }

  async listForUser(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { device: true },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  async revoke(sessionId: string, userId: string) {
    return this.prisma.session.updateMany({
      where: { id: sessionId, userId },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string) {
    await this.prisma.$transaction([
      this.prisma.session.updateMany({
        where: {
          userId,
          revokedAt: null,
          ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
        },
        data: { revokedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
          ...(exceptSessionId ? { sessionId: { not: exceptSessionId } } : {}),
        },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  async listDevices(userId: string) {
    return this.prisma.trustedDevice.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  async revokeDevice(deviceId: string, userId: string) {
    await this.prisma.$transaction([
      this.prisma.trustedDevice.update({
        where: { id: deviceId },
        data: { revokedAt: new Date(), trustedAt: null },
      }),
      this.prisma.session.updateMany({
        where: { deviceId, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private deriveName(c: ClientContext): string {
    const parts: string[] = [];
    if (c.browser) parts.push(c.browser);
    if (c.os) parts.push(`on ${c.os}`);
    return parts.length > 0 ? parts.join(' ') : 'Unknown device';
  }
}
