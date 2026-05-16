import { Injectable } from '@nestjs/common';
import { Secret, TOTP } from 'otpauth';
import { randomBytes } from 'node:crypto';
import * as QRCode from 'qrcode';
import { AppConfigService } from '../../../config/app-config.service';
import { CryptoService } from '../../crypto/crypto.service';

export interface TotpSetup {
  secret: string;        // base32, shown once to the user
  otpauthUri: string;
  qrCodeDataUrl: string; // data:image/png;base64,...
}

/**
 * RFC 6238 TOTP wrapper. The shared secret is stored encrypted in the
 * database (envelope-encrypted under the server KEK).
 */
@Injectable()
export class TotpService {
  constructor(
    private readonly cfg: AppConfigService,
    private readonly crypto: CryptoService,
  ) {}

  /** Generate a fresh secret + provisioning URI + QR code data URL. */
  async setup(accountEmail: string): Promise<TotpSetup & { secretCipher: Buffer }> {
    // 20 random bytes -> 160-bit secret, recommended by RFC.
    const secretBuf = randomBytes(20);
    const secret = new Secret({ buffer: secretBuf.buffer.slice(0) as ArrayBuffer });
    const totp = new TOTP({
      issuer: this.cfg.totpIssuer,
      label: accountEmail,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });
    const otpauthUri = totp.toString();
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri, {
      errorCorrectionLevel: 'M',
      width: 240,
      margin: 1,
    });

    const { iv, authTag, ciphertext } = this.crypto.encryptAesGcm(
      this.cfg.masterKek,
      Buffer.from(secret.base32, 'ascii'),
    );
    const secretCipher = Buffer.concat([iv, authTag, ciphertext]);
    return { secret: secret.base32, otpauthUri, qrCodeDataUrl, secretCipher };
  }

  /** Verify a 6-digit code (with ±1 window for clock skew). */
  verify(secretCipher: Buffer, code: string): boolean {
    if (!/^\d{6,8}$/.test(code)) return false;
    const base32 = this.crypto.unwrapWithKek(secretCipher).toString('ascii');
    const totp = new TOTP({
      issuer: this.cfg.totpIssuer,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(base32),
    });
    const delta = totp.validate({ token: code, window: 1 });
    return delta !== null;
  }
}
