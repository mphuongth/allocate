import { describe, it, expect } from 'vitest'
import { buildWithdrawalMaps, type WithdrawalRow } from '../withdrawalProgress'

function makeWithdrawal(overrides: Partial<WithdrawalRow> = {}): WithdrawalRow {
  return {
    transaction_id: 'tx-1',
    goal_id: 'goal-1',
    asset_type: null,
    fund_id: null,
    parent_transaction_id: 'parent-1',
    units_withdrawn: null,
    principal_withdrawn: 1_000_000,
    affects_progress: null,
    ...overrides,
  }
}

describe('buildWithdrawalMaps', () => {
  describe('bank/gold withdrawals (parent_transaction_id)', () => {
    it('includes withdrawal when affects_progress is null (default truthy)', () => {
      const wd = makeWithdrawal({ affects_progress: null })
      const { parentWdMap } = buildWithdrawalMaps([wd])
      expect(parentWdMap.get('parent-1')).toEqual({ principal: 1_000_000, units: 0 })
    })

    it('includes withdrawal when affects_progress is true', () => {
      const wd = makeWithdrawal({ affects_progress: true })
      const { parentWdMap } = buildWithdrawalMaps([wd])
      expect(parentWdMap.get('parent-1')).toEqual({ principal: 1_000_000, units: 0 })
    })

    it('excludes withdrawal when affects_progress is false', () => {
      const wd = makeWithdrawal({ affects_progress: false })
      const { parentWdMap } = buildWithdrawalMaps([wd])
      expect(parentWdMap.has('parent-1')).toBe(false)
    })

    it('accumulates only affects_progress=true withdrawals in mixed array', () => {
      const wds = [
        makeWithdrawal({ transaction_id: 'tx-1', affects_progress: true, principal_withdrawn: 500_000 }),
        makeWithdrawal({ transaction_id: 'tx-2', affects_progress: false, principal_withdrawn: 300_000 }),
        makeWithdrawal({ transaction_id: 'tx-3', affects_progress: null, principal_withdrawn: 200_000 }),
      ]
      const { parentWdMap } = buildWithdrawalMaps(wds)
      expect(parentWdMap.get('parent-1')).toEqual({ principal: 700_000, units: 0 })
    })
  })

  describe('fund withdrawals (asset_type=fund + fund_id)', () => {
    it('includes fund withdrawal when affects_progress is true', () => {
      const wd = makeWithdrawal({
        asset_type: 'fund',
        fund_id: 'fund-1',
        parent_transaction_id: null,
        units_withdrawn: 100,
        principal_withdrawn: 2_000_000,
        affects_progress: true,
      })
      const { fundWdMap } = buildWithdrawalMaps([wd])
      expect(fundWdMap.get('goal-1::fund-1')).toEqual({ units: 100, cost: 2_000_000 })
    })

    it('excludes fund withdrawal when affects_progress is false', () => {
      const wd = makeWithdrawal({
        asset_type: 'fund',
        fund_id: 'fund-1',
        parent_transaction_id: null,
        units_withdrawn: 100,
        principal_withdrawn: 2_000_000,
        affects_progress: false,
      })
      const { fundWdMap } = buildWithdrawalMaps([wd])
      expect(fundWdMap.has('goal-1::fund-1')).toBe(false)
    })

    it('uses "unallocated" key when goal_id is null', () => {
      const wd = makeWithdrawal({
        goal_id: null,
        asset_type: 'fund',
        fund_id: 'fund-1',
        parent_transaction_id: null,
        units_withdrawn: 50,
        principal_withdrawn: 1_000_000,
        affects_progress: true,
      })
      const { fundWdMap } = buildWithdrawalMaps([wd])
      expect(fundWdMap.get('unallocated::fund-1')).toEqual({ units: 50, cost: 1_000_000 })
    })
  })

  it('returns empty maps for empty input', () => {
    const { parentWdMap, fundWdMap, parentWdMapAll, fundWdMapAll } = buildWithdrawalMaps([])
    expect(parentWdMap.size).toBe(0)
    expect(fundWdMap.size).toBe(0)
    expect(parentWdMapAll.size).toBe(0)
    expect(fundWdMapAll.size).toBe(0)
  })

  // affects_progress is a PROGRESS-accounting axis, not a valuation one. The
  // progress maps (parentWdMap/fundWdMap) drop affects_progress=false rows so a
  // "doesn't count toward progress" withdrawal leaves the bar steady; the
  // valuation maps (…All) must still count it, because the money actually left
  // the holding and net worth has to fall. Reusing the progress maps for
  // valuation overstated net worth by the withdrawn amount (the bug this guards).
  describe('valuation maps (…All) count every withdrawal regardless of affects_progress', () => {
    it('includes an affects_progress=false bank/gold withdrawal in parentWdMapAll', () => {
      const wd = makeWithdrawal({ affects_progress: false, principal_withdrawn: 300_000 })
      const { parentWdMap, parentWdMapAll } = buildWithdrawalMaps([wd])
      expect(parentWdMap.has('parent-1')).toBe(false)              // progress: held steady
      expect(parentWdMapAll.get('parent-1')).toEqual({ principal: 300_000, units: 0 }) // valuation: counted
    })

    it('includes an affects_progress=false fund withdrawal in fundWdMapAll', () => {
      const wd = makeWithdrawal({
        asset_type: 'fund', fund_id: 'fund-1', parent_transaction_id: null,
        units_withdrawn: 100, principal_withdrawn: 2_000_000, affects_progress: false,
      })
      const { fundWdMap, fundWdMapAll } = buildWithdrawalMaps([wd])
      expect(fundWdMap.has('goal-1::fund-1')).toBe(false)          // progress: held steady
      expect(fundWdMapAll.get('goal-1::fund-1')).toEqual({ units: 100, cost: 2_000_000 }) // valuation: counted
    })

    it('accumulates ALL withdrawals in the valuation map while progress filters', () => {
      const wds = [
        makeWithdrawal({ transaction_id: 'tx-1', affects_progress: true, principal_withdrawn: 500_000 }),
        makeWithdrawal({ transaction_id: 'tx-2', affects_progress: false, principal_withdrawn: 300_000 }),
        makeWithdrawal({ transaction_id: 'tx-3', affects_progress: null, principal_withdrawn: 200_000 }),
      ]
      const { parentWdMap, parentWdMapAll } = buildWithdrawalMaps(wds)
      expect(parentWdMap.get('parent-1')).toEqual({ principal: 700_000, units: 0 })    // true + null only
      expect(parentWdMapAll.get('parent-1')).toEqual({ principal: 1_000_000, units: 0 }) // all three
    })
  })

  // #606 — a withdrawal that names a FUND PURCHASE as its parent but is not itself
  // fund-keyed (no fund_id, or asset_type not 'fund'). It used to land in the parent
  // map under a key nothing reads: the dashboard values a fund through the (goal,
  // fund) map and never consults parentWdMap, so the cash left while the fund kept
  // every unit — net worth overstated by the withdrawn amount, silently.
  //
  // The shape is refused at write time now (check_withdrawal_balance, #606), so
  // these cases are about the rows already in the ledger: they are valued, not
  // waved through.
  describe('a withdrawal parented to a fund purchase (#606)', () => {
    const buy = {
      transaction_id: 'buy-1',
      goal_id: 'goal-1',
      asset_type: 'fund',
      fund_id: 'fund-1',
      transaction_type: 'investment',
      amount_vnd: 2_000_000,
      units: 50,
    }

    it('is filed under the PARENT purchase\'s (goal, fund) bucket, not the parent map', () => {
      const wd = makeWithdrawal({
        parent_transaction_id: 'buy-1', units_withdrawn: 10, principal_withdrawn: 400_000,
      })
      const { fundWdMap, fundWdMapAll, parentWdMap, parentWdMapAll } = buildWithdrawalMaps([wd], [buy])
      expect(fundWdMap.get('goal-1::fund-1')).toEqual({ units: 10, cost: 400_000 })
      expect(fundWdMapAll.get('goal-1::fund-1')).toEqual({ units: 10, cost: 400_000 })
      expect(parentWdMap.has('buy-1')).toBe(false)   // counted once, in the bucket the reader reads
      expect(parentWdMapAll.has('buy-1')).toBe(false)
    })

    // The bucket key comes from the PURCHASE (that is how the dashboard keys the
    // accumulator), so a withdrawal carrying a different / missing goal_id still
    // lands on the units it actually drew on.
    it('keys by the purchase\'s goal, not the withdrawal\'s', () => {
      const wd = makeWithdrawal({
        goal_id: null, parent_transaction_id: 'buy-1', units_withdrawn: 10, principal_withdrawn: 400_000,
      })
      const { fundWdMapAll } = buildWithdrawalMaps([wd], [buy])
      expect(fundWdMapAll.get('goal-1::fund-1')).toEqual({ units: 10, cost: 400_000 })
    })

    it('uses the "unallocated" key for a purchase with no goal', () => {
      const wd = makeWithdrawal({
        parent_transaction_id: 'buy-1', units_withdrawn: 10, principal_withdrawn: 400_000,
      })
      const { fundWdMapAll } = buildWithdrawalMaps([wd], [{ ...buy, goal_id: null }])
      expect(fundWdMapAll.get('unallocated::fund-1')).toEqual({ units: 10, cost: 400_000 })
    })

    // Principal alone would drop the cost basis while every unit stayed in net
    // worth — the fund's value is NAV × units, so the sold units have to go too.
    // The row names ONE purchase, so that purchase's own price converts them.
    it('derives units pro-rata from the purchase when units_withdrawn is absent', () => {
      const wd = makeWithdrawal({
        parent_transaction_id: 'buy-1', units_withdrawn: null, principal_withdrawn: 500_000,
      })
      const { fundWdMapAll } = buildWithdrawalMaps([wd], [buy])
      expect(fundWdMapAll.get('goal-1::fund-1')).toEqual({ units: 12.5, cost: 500_000 }) // 50 × 500k/2m
    })

    it('never derives more units than the purchase holds', () => {
      const wd = makeWithdrawal({
        parent_transaction_id: 'buy-1', units_withdrawn: null, principal_withdrawn: 9_000_000,
      })
      const { fundWdMapAll } = buildWithdrawalMaps([wd], [buy])
      expect(fundWdMapAll.get('goal-1::fund-1')).toEqual({ units: 50, cost: 9_000_000 })
    })

    it('derives no units from a purchase that records none (a pending DCA seed)', () => {
      const wd = makeWithdrawal({
        parent_transaction_id: 'buy-1', units_withdrawn: null, principal_withdrawn: 500_000,
      })
      const { fundWdMapAll } = buildWithdrawalMaps([wd], [{ ...buy, units: null }])
      expect(fundWdMapAll.get('goal-1::fund-1')).toEqual({ units: 0, cost: 500_000 })
    })

    it('keeps the progress axis: an affects_progress=false row is valued but not progressed', () => {
      const wd = makeWithdrawal({
        parent_transaction_id: 'buy-1', units_withdrawn: 10, principal_withdrawn: 400_000,
        affects_progress: false,
      })
      const { fundWdMap, fundWdMapAll } = buildWithdrawalMaps([wd], [buy])
      expect(fundWdMap.has('goal-1::fund-1')).toBe(false)
      expect(fundWdMapAll.get('goal-1::fund-1')).toEqual({ units: 10, cost: 400_000 })
    })

    it('still keys a fund-keyed row by its own fund even when it also names a parent', () => {
      const wd = makeWithdrawal({
        asset_type: 'fund', fund_id: 'fund-2', parent_transaction_id: 'buy-1',
        units_withdrawn: 10, principal_withdrawn: 400_000,
      })
      const { fundWdMapAll } = buildWithdrawalMaps([wd], [buy])
      expect(fundWdMapAll.get('goal-1::fund-2')).toEqual({ units: 10, cost: 400_000 })
      expect(fundWdMapAll.has('goal-1::fund-1')).toBe(false)
    })

    // Only a FUND purchase redirects. A deposit parent, an unknown parent, or a
    // fund purchase with no fund_id all stay on the parent axis, which is where
    // lib/depositValuation reads them.
    it('leaves a bank-parented withdrawal on the parent axis', () => {
      const wd = makeWithdrawal({ parent_transaction_id: 'dep-1', principal_withdrawn: 400_000 })
      const parents = [{ ...buy, transaction_id: 'dep-1', asset_type: 'bank', fund_id: null }]
      const { parentWdMapAll, fundWdMapAll } = buildWithdrawalMaps([wd], parents)
      expect(parentWdMapAll.get('dep-1')).toEqual({ principal: 400_000, units: 0 })
      expect(fundWdMapAll.size).toBe(0)
    })

    it('leaves a withdrawal whose parent is not in the given rows on the parent axis', () => {
      const wd = makeWithdrawal({ parent_transaction_id: 'gone-1', principal_withdrawn: 400_000 })
      const { parentWdMapAll } = buildWithdrawalMaps([wd], [buy])
      expect(parentWdMapAll.get('gone-1')).toEqual({ principal: 400_000, units: 0 })
    })

    it('leaves it on the parent axis when the purchase carries no fund_id', () => {
      const wd = makeWithdrawal({ parent_transaction_id: 'buy-1', principal_withdrawn: 400_000 })
      const { parentWdMapAll, fundWdMapAll } = buildWithdrawalMaps([wd], [{ ...buy, fund_id: null }])
      expect(parentWdMapAll.get('buy-1')).toEqual({ principal: 400_000, units: 0 })
      expect(fundWdMapAll.size).toBe(0)
    })

    it('is a no-op for callers that pass no parent rows', () => {
      const wd = makeWithdrawal({ parent_transaction_id: 'buy-1', principal_withdrawn: 400_000 })
      const { parentWdMapAll } = buildWithdrawalMaps([wd])
      expect(parentWdMapAll.get('buy-1')).toEqual({ principal: 400_000, units: 0 })
    })
  })
})
