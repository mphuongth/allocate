import { describe, it, expect } from 'vitest'
import {
  MATURITY_REMINDER_DAYS,
  isTermDeposit,
  depositMaturityState,
  isMaturityActionable,
  addMonths,
  monthsBetween,
  renewalPrincipal,
  daysUntil,
  isActionableTermDeposit,
} from '../maturity'

// A YYYY-MM-DD string `n` days from today (deterministic regardless of run date).
function daysFromNow(n: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('isTermDeposit', () => {
  it('is true for a bank holding with a rate and an expiry date', () => {
    expect(isTermDeposit({ type: 'bank', interestRate: 5.5, expiryDate: '2026-08-15' })).toBe(true)
  })
  it('is false for a flexible bank deposit (no rate / no expiry)', () => {
    expect(isTermDeposit({ type: 'bank', interestRate: null, expiryDate: '2026-08-15' })).toBe(false)
    expect(isTermDeposit({ type: 'bank', interestRate: 5.5, expiryDate: null })).toBe(false)
  })
  it('is false for non-bank holdings', () => {
    expect(isTermDeposit({ type: 'fund', interestRate: 5.5, expiryDate: '2026-08-15' })).toBe(false)
    expect(isTermDeposit({ type: 'gold', interestRate: null, expiryDate: null })).toBe(false)
  })
})

describe('depositMaturityState', () => {
  it('classifies a passed maturity as matured', () => {
    expect(depositMaturityState(-1)).toBe('matured')
    expect(depositMaturityState(-30)).toBe('matured')
  })
  it('classifies today and tomorrow as maturing (REMINDER_DAYS = 1)', () => {
    expect(MATURITY_REMINDER_DAYS).toBe(1)
    expect(depositMaturityState(0)).toBe('maturing')
    expect(depositMaturityState(1)).toBe('maturing')
  })
  it('classifies the day after tomorrow onward as active', () => {
    expect(depositMaturityState(2)).toBe('active')
    expect(depositMaturityState(30)).toBe('active')
  })
})

describe('isMaturityActionable', () => {
  it('is true for matured and maturing, false for active', () => {
    expect(isMaturityActionable('matured')).toBe(true)
    expect(isMaturityActionable('maturing')).toBe(true)
    expect(isMaturityActionable('active')).toBe(false)
  })
})

describe('addMonths', () => {
  it('adds whole months keeping the day of month', () => {
    expect(addMonths('2026-08-15', 12)).toBe('2027-08-15')
    expect(addMonths('2026-06-14', 6)).toBe('2026-12-14')
    expect(addMonths('2026-11-20', 3)).toBe('2027-02-20')
  })
  it('clamps to the last day when the target month is shorter', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28') // Feb 2026 has 28 days
    expect(addMonths('2026-08-31', 1)).toBe('2026-09-30') // Sep has 30 days
  })
  it('handles a zero-month term as a no-op', () => {
    expect(addMonths('2026-06-13', 0)).toBe('2026-06-13')
  })
})

describe('monthsBetween', () => {
  it('counts whole months for a standard term', () => {
    expect(monthsBetween('2025-08-15', '2026-08-15')).toBe(12)
    expect(monthsBetween('2026-03-01', '2026-06-01')).toBe(3)
    expect(monthsBetween('2026-06-14', '2026-12-14')).toBe(6)
  })
  it('does not count an incomplete final month', () => {
    expect(monthsBetween('2026-01-20', '2026-04-10')).toBe(2) // not yet 3 full months
  })
})

describe('daysUntil', () => {
  it('is 0 today, positive in the future, negative in the past', () => {
    expect(daysUntil(daysFromNow(0))).toBe(0)
    expect(daysUntil(daysFromNow(5))).toBe(5)
    expect(daysUntil(daysFromNow(-3))).toBe(-3)
  })
})

describe('isActionableTermDeposit', () => {
  it('is true for a matured or soon-maturing bank term deposit', () => {
    expect(isActionableTermDeposit({ type: 'bank', interestRate: 6, expiryDate: daysFromNow(-1) })).toBe(true)
    expect(isActionableTermDeposit({ type: 'bank', interestRate: 6, expiryDate: daysFromNow(1) })).toBe(true)
  })
  it('is false for a deposit maturing well in the future', () => {
    expect(isActionableTermDeposit({ type: 'bank', interestRate: 6, expiryDate: daysFromNow(30) })).toBe(false)
  })
  it('is false for non-term and non-bank holdings', () => {
    expect(isActionableTermDeposit({ type: 'bank', interestRate: null, expiryDate: daysFromNow(-1) })).toBe(false)
    expect(isActionableTermDeposit({ type: 'gold', interestRate: null, expiryDate: null })).toBe(false)
  })
})

describe('renewalPrincipal', () => {
  it('rolls interest into principal for principal_interest', () => {
    expect(renewalPrincipal('principal_interest', 35_000_000, 2_030_000, null)).toBe(37_030_000)
  })
  it('keeps the principal unchanged for principal_only', () => {
    expect(renewalPrincipal('principal_only', 35_000_000, 2_030_000, null)).toBe(35_000_000)
  })
  it('uses the new amount for change', () => {
    expect(renewalPrincipal('change', 35_000_000, 2_030_000, 40_000_000)).toBe(40_000_000)
  })
})
