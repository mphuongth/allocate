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
})
