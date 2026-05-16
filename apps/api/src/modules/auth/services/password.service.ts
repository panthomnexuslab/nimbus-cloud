import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Argon2id password hashing. Parameters chosen to clear OWASP 2024
 * guidance (m=64MiB, t=3, p=1). On low-spec hosts you can tune via env;
 * keep at minimum m=19MiB to stay within OWASP "minimum acceptable".
 */
@Injectable()
export class PasswordService {
  private static readonly OPTIONS: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 64 * 1024, // 64 MiB
    timeCost: 3,
    parallelism: 1,
  };

  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, PasswordService.OPTIONS);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    if (!hash) return false;
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /** Decide if an existing hash should be re-hashed because params changed. */
  needsRehash(hash: string): boolean {
    try {
      return argon2.needsRehash(hash, PasswordService.OPTIONS);
    } catch {
      return true;
    }
  }
}
