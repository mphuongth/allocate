import { createHash, timingSafeEqual } from 'crypto'

// Constant-time check of a cron request's `Authorization` header against
// CRON_SECRET. A plain `!==` string compare short-circuits on the first
// differing byte, leaking the secret one character at a time via response
// timing. We instead SHA-256 both sides and timingSafeEqual the fixed 32-byte
// digests — equal-length buffers (so timingSafeEqual never throws on a length
// mismatch) and no per-byte early exit, so neither the secret's value nor its
// length is observable from timing.
//
// Fails closed: a missing header or an unset/empty secret returns false.
export function verifyCronAuth(authHeader: string | null, secret: string | undefined): boolean {
  if (!secret) return false
  const expected = createHash('sha256').update(`Bearer ${secret}`).digest()
  const actual = createHash('sha256').update(authHeader ?? '').digest()
  return timingSafeEqual(actual, expected)
}
