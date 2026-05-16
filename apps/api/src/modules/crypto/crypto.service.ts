import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { AppConfigService } from '../../config/app-config.service';

const scrypt = promisify(scryptCb);

export interface AesGcmCiphertext {
  iv: Buffer;          // 12 bytes
  authTag: Buffer;     // 16 bytes
  ciphertext: Buffer;
}

export interface WrappedKey {
  blob: Buffer;        // [iv(12) | authTag(16) | ciphertext(n)]
  kekVersion: number;
}

/**
 * Envelope encryption helper.
 *
 *  - The server holds a 32-byte master KEK (Key Encryption Key) loaded
 *    from `MASTER_KEK_HEX`. The KEK never leaves memory and is never
 *    persisted in the database.
 *  - Per-user DEKs (Data Encryption Keys) are random 32-byte keys,
 *    wrapped (encrypted) with the KEK and stored as `User.wrappedDek`
 *    in the DB.
 *  - Per-file content keys are random 32-byte keys, wrapped with the
 *    user DEK and stored in the `EncryptionKey` table.
 *  - File contents are encrypted with AES-256-GCM. The IV (12 bytes)
 *    and auth tag (16 bytes) are stored on the `File` row.
 *
 * Rotating the KEK is a matter of re-wrapping all DEKs and bumping the
 * KEK version — content keys + file ciphertexts don't need to change.
 */
@Injectable()
export class CryptoService {
  private static readonly KEK_VERSION = 1;
  private static readonly IV_LEN = 12;
  private static readonly TAG_LEN = 16;
  private static readonly KEY_LEN = 32; // 256-bit
  private readonly kek: Buffer;

  constructor(cfg: AppConfigService) {
    this.kek = cfg.masterKek;
    if (this.kek.length !== CryptoService.KEY_LEN) {
      throw new Error('Master KEK must be 32 bytes');
    }
  }

  // --- AES-256-GCM ------------------------------------------------------
  encryptAesGcm(key: Buffer, plaintext: Buffer, aad?: Buffer): AesGcmCiphertext {
    if (key.length !== CryptoService.KEY_LEN) throw new Error('Key must be 32 bytes');
    const iv = randomBytes(CryptoService.IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    if (aad) cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return { iv, authTag, ciphertext };
  }

  decryptAesGcm(key: Buffer, ct: AesGcmCiphertext, aad?: Buffer): Buffer {
    const decipher = createDecipheriv('aes-256-gcm', key, ct.iv);
    decipher.setAuthTag(ct.authTag);
    if (aad) decipher.setAAD(aad);
    return Buffer.concat([decipher.update(ct.ciphertext), decipher.final()]);
  }

  // --- Key wrapping (envelope) -----------------------------------------
  /** Wrap a key with the master KEK. */
  wrapWithKek(key: Buffer): WrappedKey {
    const { iv, authTag, ciphertext } = this.encryptAesGcm(this.kek, key);
    return {
      blob: Buffer.concat([iv, authTag, ciphertext]),
      kekVersion: CryptoService.KEK_VERSION,
    };
  }

  /** Unwrap a key blob with the master KEK. */
  unwrapWithKek(blob: Buffer): Buffer {
    return this.openWrapped(this.kek, blob);
  }

  /** Wrap a key with an arbitrary (user/file) wrapping key. */
  wrapWith(wrapper: Buffer, key: Buffer): Buffer {
    const { iv, authTag, ciphertext } = this.encryptAesGcm(wrapper, key);
    return Buffer.concat([iv, authTag, ciphertext]);
  }

  unwrapWith(wrapper: Buffer, blob: Buffer): Buffer {
    return this.openWrapped(wrapper, blob);
  }

  private openWrapped(wrapper: Buffer, blob: Buffer): Buffer {
    if (blob.length < CryptoService.IV_LEN + CryptoService.TAG_LEN + 1) {
      throw new Error('Wrapped blob too short');
    }
    const iv = blob.subarray(0, CryptoService.IV_LEN);
    const authTag = blob.subarray(
      CryptoService.IV_LEN,
      CryptoService.IV_LEN + CryptoService.TAG_LEN,
    );
    const ciphertext = blob.subarray(CryptoService.IV_LEN + CryptoService.TAG_LEN);
    return this.decryptAesGcm(wrapper, { iv, authTag, ciphertext });
  }

  // --- Key derivation ---------------------------------------------------
  /** Derive a key from a password using scrypt (for legacy shared-link passwords). */
  async deriveKey(password: string, salt: Buffer, keyLen = CryptoService.KEY_LEN): Promise<Buffer> {
    const key = (await scrypt(password, salt, keyLen, { N: 1 << 15, r: 8, p: 1 })) as Buffer;
    return key;
  }

  randomKey(): Buffer {
    return randomBytes(CryptoService.KEY_LEN);
  }

  randomIv(): Buffer {
    return randomBytes(CryptoService.IV_LEN);
  }

  // --- Misc -------------------------------------------------------------
  /** Deterministic SHA-256 over input. */
  hash(input: Buffer | string): Buffer {
    return createHash('sha256').update(input).digest();
  }

  /** Constant-time buffer compare. */
  constantTimeEqual(a: Buffer, b: Buffer): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
