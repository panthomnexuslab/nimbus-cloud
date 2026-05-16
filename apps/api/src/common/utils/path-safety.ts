import { posix } from 'node:path';

/**
 * Validates a user-supplied file or folder name to defeat path
 * traversal and a swath of OS-specific gotchas.
 *
 * Allowed:
 *   - Length 1–255
 *   - Unicode letters / numbers / spaces / `_ - . ( ) [ ] @ + #`
 * Rejected:
 *   - Anything containing `/`, `\`, NUL, `..`
 *   - Reserved Windows names (CON, NUL, COM1, ...)
 *   - Leading/trailing whitespace or dots
 *   - Hidden file abuse: a single leading `.` is allowed, but `...` or
 *     `..` are not.
 */
const RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

const NAME_REGEX = /^[\p{L}\p{N} _.\-()\[\]@+#&'!,~]+$/u;

export function isSafeName(name: string): boolean {
  if (typeof name !== 'string') return false;
  if (name.length < 1 || name.length > 255) return false;
  if (/[\/\\\x00]/.test(name)) return false;
  if (name === '.' || name === '..') return false;
  if (name.startsWith(' ') || name.endsWith(' ')) return false;
  if (name.endsWith('.')) return false;
  if (RESERVED.has(name.split('.')[0].toUpperCase())) return false;
  return NAME_REGEX.test(name);
}

/**
 * Build a server-side storage key from random fragments so the key
 * never reflects any user input. Returns a posix-style path.
 */
export function buildStorageKey(
  bucketPrefix: string,
  userId: string,
  objectId: string,
  ext?: string,
): string {
  const safeExt = ext ? ext.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) : '';
  const tail = safeExt ? `.${safeExt}` : '';
  // userId/aa/bb/objectId  -- shard by hex prefix to keep listings fast
  const shard1 = objectId.slice(0, 2);
  const shard2 = objectId.slice(2, 4);
  return posix.join(bucketPrefix, userId, shard1, shard2, `${objectId}${tail}`);
}

/** Strip directory components / NUL bytes — last-line defense. */
export function sanitizeBasename(name: string): string {
  return name.replace(/[\\/\x00]/g, '_').slice(0, 255);
}
