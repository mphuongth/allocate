import { describe, expect, it } from 'vitest'
import { classifyAccumulatingTopUp } from '../accumulatingTopUp'

describe('classifyAccumulatingTopUp', () => {
  const expiryDate = '2026-09-03'

  it('blocks a top-up exactly on the inclusive lock-window boundary', () => {
    expect(classifyAccumulatingTopUp({
      topUpDate: '2026-08-04', expiryDate, lockDays: 30,
    })).toEqual({ status: 'locked-near-maturity', daysRemaining: 30, lockDays: 30 })
  })

  it('allows a top-up before the lock window', () => {
    expect(classifyAccumulatingTopUp({
      topUpDate: '2026-08-03', expiryDate, lockDays: 30,
    })).toEqual({ status: 'allowed' })
  })

  it('keeps legacy books open until their maturity day', () => {
    expect(classifyAccumulatingTopUp({
      topUpDate: '2026-08-04', expiryDate, lockDays: null,
    })).toEqual({ status: 'allowed' })
  })

  it('refuses a top-up on or after maturity', () => {
    expect(classifyAccumulatingTopUp({
      topUpDate: expiryDate, expiryDate, lockDays: null,
    })).toEqual({ status: 'matured', daysRemaining: 0 })
    expect(classifyAccumulatingTopUp({
      topUpDate: '2026-09-04', expiryDate, lockDays: 30,
    })).toEqual({ status: 'matured', daysRemaining: -1 })
  })
})
