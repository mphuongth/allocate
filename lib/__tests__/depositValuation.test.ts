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

  // Valuation must NOT bend to affects_progress — the money left the holding, so
  // its book value falls whether or not the withdrawal counts toward the goal
  // bar. The overview feeds the VALUATION map (parentWdMapAll) here; it used to
  // (wrongly) feed the progress-filtered map, overstating net worth and making
  // the same deposit show two different values vs the goal-detail tab (which
  // always counts every withdrawal). See lib/withdrawalProgress + the decoupled
  // currentValue/progressValue split in the overview route.
  it('subtracts an affects_progress=false withdrawal when valued (uses the …All map)', () => {
    const maps = buildWithdrawalMaps([
      withdrawal({ principal_withdrawn: 4_000_000, affects_progress: false }),
    ])
    // Progress map drops it (bar held steady) → would keep full principal.
    const progress = valueNonFundHolding(bank({ amount_vnd: 10_000_000 }), maps.parentWdMap, null, ASOF)!
    expect(progress.effectiveAmount).toBe(10_000_000)
    // Valuation map counts it (net worth falls) → principal net of the withdrawal.
    const valuation = valueNonFundHolding(bank({ amount_vnd: 10_000_000 }), maps.parentWdMapAll, null, ASOF)!
    expect(valuation.effectiveAmount).toBe(6_000_000)
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

  // Merge-on-renew (fold a sibling bank deposit into a renewing term deposit).
  // The combine flow settles a sibling S EARLY and adds the cash received to the
  // renewed deposit D's principal. We replay the overview route's TWO-map
  // accumulation (route lines 262–296): net worth sums valueNonFundHolding over
  // parentWdMapAll (every withdrawal), progress sums it over parentWdMap (only
  // affects_progress=true). The source-closing withdrawal must be
  // affects_progress=TRUE so S's progress contribution → 0 while D's growth adds
  // it back — an internal transfer, no double-count. See plans/functional-
  // frolicking-sun.md constraints 2–3.
  describe('merge-on-renew sibling fold', () => {
    // No rate → interest 0 → currentValue == effectiveAmount, so the money maths
    // is exact. D = the renewing deposit, S = the sibling settled into it.
    const BASE = 70_000_000   // D's principal before the merge
    const S_EFF = 8_000_000   // S's effective (remaining) principal

    // Mirror the overview accumulation: net worth uses the …All map (every
    // withdrawal lowers it), progress uses the filtered map (steady bar).
    const netWorth = (holdings: NonFundHoldingRow[], maps: ReturnType<typeof buildWithdrawalMaps>) =>
      holdings.reduce((s, h) => s + (valueNonFundHolding(h, maps.parentWdMapAll, null, ASOF)?.currentValue ?? 0), 0)
    const progress = (holdings: NonFundHoldingRow[], maps: ReturnType<typeof buildWithdrawalMaps>) =>
      holdings.reduce((s, h) => s + (valueNonFundHolding(h, maps.parentWdMap, null, ASOF)?.currentValue ?? 0), 0)

    const D = (amount: number) => bank({ transaction_id: 'D', amount_vnd: amount })
    const S = bank({ transaction_id: 'S', amount_vnd: S_EFF })
    // The full-close withdrawal the RPC writes against S: principal_withdrawn =
    // S's effective principal (so S's valuation nets to 0). Valuation keys off
    // principal_withdrawn — the cash received only changes D's principal, which
    // these fixtures model directly as BASE + received.
    const closeS = (affectsProgress = true): WithdrawalRow =>
      withdrawal({ transaction_id: 'wd-S', parent_transaction_id: 'S', principal_withdrawn: S_EFF, affects_progress: affectsProgress })

    it('held-to-value (received == S_eff): net worth AND progress both stay steady', () => {
      const before = [D(BASE), S]
      const mapsBefore = buildWithdrawalMaps([])
      const nwBefore = netWorth(before, mapsBefore)
      const pgBefore = progress(before, mapsBefore)

      // After: D grew by the received cash, S is fully closed.
      const received = S_EFF
      const after = [D(BASE + received), S]
      const mapsAfter = buildWithdrawalMaps([closeS()])

      expect(netWorth(after, mapsAfter)).toBe(nwBefore)   // net worth steady (no penalty)
      expect(progress(after, mapsAfter)).toBe(pgBefore)    // the required progress invariant
    })

    it('early settlement (received < S_eff): net worth and progress both fall by exactly the penalty, never double-count', () => {
      const before = [D(BASE), S]
      const mapsBefore = buildWithdrawalMaps([])
      const nwBefore = netWorth(before, mapsBefore)
      const pgBefore = progress(before, mapsBefore)

      const received = 6_000_000
      const penalty = S_EFF - received // 2,000,000 forfeited interest/penalty
      const after = [D(BASE + received), S]
      const mapsAfter = buildWithdrawalMaps([closeS()])

      expect(netWorth(after, mapsAfter)).toBe(nwBefore - penalty)
      expect(progress(after, mapsAfter)).toBe(pgBefore - penalty)
    })

    it('negative control: affects_progress=FALSE double-counts S (progress bumps by the received amount)', () => {
      const before = [D(BASE), S]
      const pgBefore = progress(before, buildWithdrawalMaps([]))

      const received = S_EFF
      const after = [D(BASE + received), S]
      // WRONG flag: the close is excluded from the progress map, so S keeps its
      // full contribution while D also grew — S counted twice.
      const mapsBad = buildWithdrawalMaps([closeS(false)])

      expect(progress(after, mapsBad)).toBe(pgBefore + received) // documents why the flag MUST be true
    })

    it('drops the fully-closed source from net worth (its …All valuation is null)', () => {
      const maps = buildWithdrawalMaps([closeS()])
      expect(valueNonFundHolding(S, maps.parentWdMapAll, null, ASOF)).toBeNull()
    })
  })

  // The overview route must pass a fixed "today midnight" asOf to valueNonFundHolding
  // so that bank deposit values are stable across multiple API calls within the same day.
  // Without this, calcProjectedInterest uses Date.now() and the networth changes every
  // millisecond — visible as a number jump when the 2-min localStorage cache expires and
  // a fresh fetch returns a slightly different value (issue #402).
  it('same interest when asOf is pinned to midnight — stable-daily contract the route must honour', () => {
    const { parentWdMap } = buildWithdrawalMaps([])
    const deposit = bank({ amount_vnd: 100_000_000, interest_rate: 7, investment_date: '2026-01-01', expiry_date: '2027-01-01' })
    const midnightToday = Date.UTC(2026, 6, 1)  // what the route passes — fixed per day

    // Two calls with the same midnight asOf must return identical values.
    const v1 = valueNonFundHolding(deposit, parentWdMap, null, midnightToday)!
    const v2 = valueNonFundHolding(deposit, parentWdMap, null, midnightToday)!
    expect(v1.currentValue).toBe(v2.currentValue)

    // Contrast: calls a millisecond apart (simulating Date.now() drift) differ.
    const v3 = valueNonFundHolding(deposit, parentWdMap, null, midnightToday + 1)!
    expect(v3.currentValue).toBeGreaterThan(v1.currentValue)  // proves sub-day drift exists
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
