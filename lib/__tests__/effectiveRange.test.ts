import { describe, it, expect } from 'vitest'
import {
  INVERTED_RANGE_MESSAGE,
  isRangeCheckViolation,
  mergedRangeIsInverted,
  needsStoredRange,
} from '../effectiveRange'

// Guard for #686. `fixed_expenses` and `recurring_savings` both carry
// CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_from <= effective_to),
// but the PUT routes validated only the fields the request happened to send. A
// PUT of `{ effective_from }` alone compared the new endpoint against null
// instead of the stored `effective_to`, sailed past the route check, and hit the
// constraint — which the catch-all then reported as 404 "not found" about a row
// that is right there.
//
// The merge decision is pure: given what the body supplies and what the row
// stores, is the resulting range inverted? Testing it here rather than through
// two near-identical route suites is what keeps both routes honest with one set
// of cases.
describe('needsStoredRange (#686)', () => {
  it('needs no read when the body supplies both endpoints', () => {
    // Both endpoints known → the resulting range is fully determined.
    expect(needsStoredRange({ from: '2026-07-01', to: '2026-06-01' })).toBe(false)
    expect(needsStoredRange({ from: null, to: null })).toBe(false)
  })

  it('needs no read when the body touches neither endpoint', () => {
    expect(needsStoredRange({})).toBe(false)
  })

  it('needs no read when the supplied endpoint is being cleared', () => {
    // Clearing can never invert a range: NULL disables the CHECK on that side.
    expect(needsStoredRange({ from: null })).toBe(false)
    expect(needsStoredRange({ to: null })).toBe(false)
  })

  it('needs the stored row when only one endpoint is set', () => {
    expect(needsStoredRange({ from: '2026-07-01' })).toBe(true)
    expect(needsStoredRange({ to: '2026-06-01' })).toBe(true)
  })
})

describe('mergedRangeIsInverted (#686)', () => {
  const stored = { effective_from: '2026-03-01', effective_to: '2026-06-01' }

  it('rejects a from moved past the stored to', () => {
    expect(mergedRangeIsInverted({ from: '2026-07-01' }, stored)).toBe(true)
  })

  it('rejects a to moved before the stored from', () => {
    expect(mergedRangeIsInverted({ to: '2026-02-01' }, stored)).toBe(true)
  })

  it('accepts a from that still lands on or before the stored to', () => {
    expect(mergedRangeIsInverted({ from: '2026-06-01' }, stored)).toBe(false)
    expect(mergedRangeIsInverted({ from: '2026-05-01' }, stored)).toBe(false)
  })

  it('accepts a to that still lands on or after the stored from', () => {
    expect(mergedRangeIsInverted({ to: '2026-03-01' }, stored)).toBe(false)
    expect(mergedRangeIsInverted({ to: '2026-04-01' }, stored)).toBe(false)
  })

  it('accepts either endpoint against an open-ended stored row', () => {
    const open = { effective_from: null, effective_to: null }
    expect(mergedRangeIsInverted({ from: '2026-07-01' }, open)).toBe(false)
    expect(mergedRangeIsInverted({ to: '2026-02-01' }, open)).toBe(false)
  })

  it('accepts clearing an endpoint however the stored row looks', () => {
    expect(mergedRangeIsInverted({ from: null }, stored)).toBe(false)
    expect(mergedRangeIsInverted({ to: null }, stored)).toBe(false)
  })

  it('judges a body that supplies both endpoints on its own, ignoring the row', () => {
    // The full-update case the routes already handled — same answer, one helper.
    expect(mergedRangeIsInverted({ from: '2026-08-01', to: '2026-07-01' }, stored)).toBe(true)
    expect(mergedRangeIsInverted({ from: '2026-01-01', to: '2026-02-01' }, stored)).toBe(false)
  })

  it('treats an absent stored row as nothing to contradict', () => {
    // Ownership/existence is the update statement's job; a missing row must not
    // become a 400 here or a foreign id would answer differently from a
    // nonexistent one.
    expect(mergedRangeIsInverted({ from: '2026-07-01' }, null)).toBe(false)
  })
})

describe('isRangeCheckViolation (#686)', () => {
  it('recognises the constraint by name', () => {
    // fixed_expenses names it; recurring_savings declares it inline, so Postgres
    // generates recurring_savings_check.
    expect(isRangeCheckViolation({ code: '23514', message: 'violates check constraint "effective_dates_order"' })).toBe(true)
    expect(isRangeCheckViolation({ code: '23514', message: 'violates check constraint "recurring_savings_check"' })).toBe(true)
  })

  it('ignores other check violations', () => {
    // amount_vnd > 0 is a different refusal with a different message.
    expect(isRangeCheckViolation({ code: '23514', message: 'violates check constraint "recurring_savings_amount_vnd_check"' })).toBe(false)
  })

  it('ignores unrelated errors and no error at all', () => {
    expect(isRangeCheckViolation({ code: '23503', message: 'foreign key' })).toBe(false)
    expect(isRangeCheckViolation(null)).toBe(false)
  })
})

describe('INVERTED_RANGE_MESSAGE (#686)', () => {
  it('names both fields the way the form labels them', () => {
    expect(INVERTED_RANGE_MESSAGE).toContain('Active from')
    expect(INVERTED_RANGE_MESSAGE).toContain('Active until')
  })
})
