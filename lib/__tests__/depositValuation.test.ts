import { describe, it, expect } from 'vitest'
import { valueNonFundHolding, type NonFundHoldingRow } from '../depositValuation'
import { buildWithdrawalMaps, type WithdrawalRow } from '../withdrawalProgress'

// A fixed instant so the pro-rated interest is deterministic regardless of the
// run date. calcProjectedInterest caps accrual at maturity, so picking an asOf
// inside the term keeps the maths simple.
const ASOF = Date.UTC(2026, 6, 1) // 2026-07-01

function bank(overrides: Partial<NonFundHoldingRow> = {}): NonFundHoldingRow {
  return {
    transaction_id: 'tx-1',
    asset_type: 'bank',
    amount_vnd: 10_000_000,
    units: null,
    interest_rate: null, // no rate → interest 0 → currentValue == effectiveAmount (clean principal asserts)
    investment_date: '2026-01-01',
    expiry_date: null,
    ...overrides,
  }
}

function withdrawal(overrides: Partial<WithdrawalRow> = {}): WithdrawalRow {
  return {
    transaction_id: 'wd-1',
    goal_id: 'goal-1',
    asset_type: null,
    fund_id: null,
    parent_transaction_id: 'tx-1',
    units_withdrawn: null,
    principal_withdrawn: 0,
    affects_progress: true,
    ...overrides,
  }
}

describe('valueNonFundHolding', () => {
  it('values a bank deposit with no withdrawals at its full principal', () => {
    const { parentWdMap } = buildWithdrawalMaps([])
    const v = valueNonFundHolding(bank({ amount_vnd: 10_000_000 }), parentWdMap, null, ASOF)
    expect(v).toEqual({ effectiveAmount: 10_000_000, currentValue: 10_000_000, effectiveUnits: null })
  })

  it('adds pro-rated interest for a rate-bearing term deposit', () => {
    const { parentWdMap } = buildWithdrawalMaps([])
    // 6M × 6% × 181/365 (2026-01-01 → 2026-07-01), capped at maturity 2026-12-31.
    const v = valueNonFundHolding(
      bank({ amount_vnd: 6_000_000, interest_rate: 6, expiry_date: '2026-12-31' }),
      parentWdMap, null, ASOF,
    )!
    const expectedInterest = 6_000_000 * 0.06 * (181 / 365)
    expect(v.effectiveAmount).toBe(6_000_000)
    expect(v.currentValue).toBeCloseTo(6_000_000 + expectedInterest, 5)
  })

  it('subtracts a partial withdrawal parented to the deposit', () => {
    const { parentWdMap } = buildWithdrawalMaps([withdrawal({ principal_withdrawn: 4_000_000 })])
    const v = valueNonFundHolding(bank({ amount_vnd: 10_000_000 }), parentWdMap, null, ASOF)!
    expect(v.effectiveAmount).toBe(6_000_000)
  })

  it('returns null for a fully-withdrawn deposit (caller skips it)', () => {
    const { parentWdMap } = buildWithdrawalMaps([withdrawal({ principal_withdrawn: 10_000_000 })])
    expect(valueNonFundHolding(bank({ amount_vnd: 10_000_000 }), parentWdMap, null, ASOF)).toBeNull()
  })

  // Regression (review point 3 / E2E goal-detail-desktop.spec.ts:276): after a
  // renewal the closed cycle's withdrawal is re-parented onto the history
  // snapshot, so parentWdMap is keyed by the SNAPSHOT id — not the active row.
  // The active row therefore finds no withdrawal and keeps its full rolled-
  // forward principal; the 4M is NOT subtracted a second time.
  it('does not double-count a re-parented withdrawal after renewal', () => {
    // The renewed active row already rolled forward to net principal 6M.
    const active = bank({ transaction_id: 'active', amount_vnd: 6_000_000 })
    // The withdrawal was moved onto the snapshot (its parent is now the snapshot).
    const { parentWdMap } = buildWithdrawalMaps([
      withdrawal({ transaction_id: 'wd-1', parent_transaction_id: 'snapshot', principal_withdrawn: 4_000_000 }),
    ])
    const v = valueNonFundHolding(active, parentWdMap, null, ASOF)!
    expect(v.effectiveAmount).toBe(6_000_000) // full renewed principal, no double-count

    // Sanity: had the withdrawal stayed parented to the active row (the bug this
    // guards against), the same code would have short-changed it by 4M.
    const { parentWdMap: buggyMap } = buildWithdrawalMaps([
      withdrawal({ transaction_id: 'wd-1', parent_transaction_id: 'active', principal_withdrawn: 4_000_000 }),
    ])
    expect(valueNonFundHolding(active, buggyMap, null, ASOF)!.effectiveAmount).toBe(2_000_000)
  })

  describe('gold', () => {
    it('values remaining units at the gold price and reduces units by the sale', () => {
      const { parentWdMap } = buildWithdrawalMaps([
        withdrawal({ units_withdrawn: 2, principal_withdrawn: 3_000_000 }),
      ])
      const gold = bank({ asset_type: 'gold', amount_vnd: 15_000_000, units: 5, interest_rate: null })
      const v = valueNonFundHolding(gold, parentWdMap, 4_000_000, ASOF)!
      expect(v.effectiveUnits).toBe(3)               // 5 − 2 sold
      expect(v.currentValue).toBe(3 * 4_000_000)     // remaining units × price
      expect(v.effectiveAmount).toBe(12_000_000)     // 15M − 3M principal sold
    })

    it('returns null once all gold units are sold', () => {
      const { parentWdMap } = buildWithdrawalMaps([
        withdrawal({ units_withdrawn: 5, principal_withdrawn: 15_000_000 }),
      ])
      const gold = bank({ asset_type: 'gold', amount_vnd: 15_000_000, units: 5 })
      expect(valueNonFundHolding(gold, parentWdMap, 4_000_000, ASOF)).toBeNull()
    })

    it('falls back to the principal branch when no gold price is available', () => {
      const { parentWdMap } = buildWithdrawalMaps([])
      const gold = bank({ asset_type: 'gold', amount_vnd: 15_000_000, units: 5, interest_rate: null })
      const v = valueNonFundHolding(gold, parentWdMap, null, ASOF)!
      expect(v.effectiveAmount).toBe(15_000_000)
      expect(v.currentValue).toBe(15_000_000) // no rate, no price → principal only
      expect(v.effectiveUnits).toBe(5)        // unchanged
    })
  })
})
