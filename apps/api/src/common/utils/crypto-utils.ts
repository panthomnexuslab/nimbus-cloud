import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** SHA-256 hex digest. */
export function sha256Hex(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** SHA-256 base64url digest. */
export function sha256Base64Url(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('base64url');
}

/** Cryptographically random base64url string. */
export function randomBase64Url(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Constant-time string compare. */
export function timingSafeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Generate a refresh token + its hash. The raw token is sent to the
 * client; only the hash is persisted, so a DB leak doesn't grant
 * session-resumption.
 */
export function generateOpaqueToken(): { raw: string; hash: string } {
  const raw = randomBase64Url(32);
  return { raw, hash: sha256Hex(raw) };
}
