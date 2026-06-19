import { describe, it, expect } from 'vitest'
import { verifyCronAuth } from '../cron-auth'

describe('verifyCronAuth', () => {
  const secret = 'topsecret123'

  it('accepts the exact Bearer token', () => {
    expect(verifyCronAuth(`Bearer ${secret}`, secret)).toBe(true)
  })

  it('rejects a wrong token of the same length', () => {
    expect(verifyCronAuth('Bearer topsecret124', secret)).toBe(false)
  })

  it('rejects a missing Authorization header', () => {
    expect(verifyCronAuth(null, secret)).toBe(false)
  })

  it('rejects a token without the Bearer prefix', () => {
    expect(verifyCronAuth(secret, secret)).toBe(false)
  })

  it('rejects a token that is a prefix of the secret (no length-mismatch throw)', () => {
    expect(verifyCronAuth(`Bearer ${secret.slice(0, -1)}`, secret)).toBe(false)
    expect(verifyCronAuth(`Bearer ${secret}extra`, secret)).toBe(false)
  })

  it('fails closed when no secret is configured', () => {
    expect(verifyCronAuth(`Bearer ${secret}`, undefined)).toBe(false)
    expect(verifyCronAuth('Bearer ', '')).toBe(false)
  })
})
