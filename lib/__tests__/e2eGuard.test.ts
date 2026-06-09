import { describe, it, expect } from 'vitest'
import {
  extractProjectRef,
  isProductionTarget,
  assertSafeTestTarget,
  PRODUCTION_PROJECT_REFS,
} from '../../e2e/helpers/guard'

const PROD = PRODUCTION_PROJECT_REFS[0]

describe('extractProjectRef', () => {
  it('pulls the ref from a Supabase REST URL', () => {
    expect(extractProjectRef(`https://${PROD}.supabase.co`)).toBe(PROD)
    expect(extractProjectRef(`https://${PROD}.supabase.co/`)).toBe(PROD)
  })

  it('returns null for empty / unrecognised values', () => {
    expect(extractProjectRef(undefined)).toBeNull()
    expect(extractProjectRef('')).toBeNull()
    expect(extractProjectRef('http://localhost:54321')).toBeNull()
  })
})

describe('isProductionTarget', () => {
  it('flags the known production project', () => {
    expect(isProductionTarget(`https://${PROD}.supabase.co`)).toBe(true)
  })

  it('does not flag a different (test) project', () => {
    expect(isProductionTarget('https://sometestproject1234.supabase.co')).toBe(false)
    expect(isProductionTarget(undefined)).toBe(false)
  })
})

describe('assertSafeTestTarget', () => {
  it('throws when pointed at production', () => {
    expect(() => assertSafeTestTarget(`https://${PROD}.supabase.co`)).toThrow(/production/i)
  })

  it('passes for a non-production target', () => {
    expect(() => assertSafeTestTarget('https://sometestproject1234.supabase.co')).not.toThrow()
  })

  it('allows an explicit override (e.g. E2E_ALLOW_PROD=1)', () => {
    expect(() => assertSafeTestTarget(`https://${PROD}.supabase.co`, { allow: true })).not.toThrow()
  })
})
