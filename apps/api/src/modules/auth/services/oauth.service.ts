import { Injectable, BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CryptoService } from '../../crypto/crypto.service';

export interface OAuthProfile {
  provider: 'google';
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
  avatarUrl?: string;
}

/**
 * Maps OAuth profiles to local users. New users get a wrapped DEK
 * created at first login so they can encrypt files immediately.
 */
@Injectable()
export class OAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async findOrCreate(profile: OAuthProfile, tx?: Prisma.TransactionClient) {
    if (!profile.email) throw new BadRequestException('OAuth profile missing email');
    if (!profile.emailVerified) throw new BadRequestException('OAuth email not verified');
    const client = tx ?? this.prisma;
    const linked = await client.oAuthAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider: profile.provider,
          providerUserId: profile.providerUserId,
        },
      },
      include: { user: true },
    });
    if (linked) return linked.user;

    return client.$transaction(async (innerTx) => {
      let user = await innerTx.user.findUnique({ where: { email: profile.email.toLowerCase() } });
      if (!user) {
        const dek = this.crypto.randomKey();
        const wrapped = this.crypto.wrapWithKek(dek);
        user = await innerTx.user.create({
          data: {
            email: profile.email.toLowerCase(),
            displayName: profile.displayName ?? '',
            avatarUrl: profile.avatarUrl,
            emailVerifiedAt: new Date(),
            status: 'ACTIVE',
            wrappedDek: wrapped.blob,
            dekVersion: wrapped.kekVersion,
          },
        });
      }
      await innerTx.oAuthAccount.create({
        data: {
          userId: user.id,
          provider: profile.provider,
          providerUserId: profile.providerUserId,
          email: profile.email.toLowerCase(),
        },
      });
      return user;
    });
  }
}
