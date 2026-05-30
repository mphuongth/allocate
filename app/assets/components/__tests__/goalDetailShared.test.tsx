import { describe, it, expect } from 'vitest'
import { buildInvRows, calcDeadlineMonths, type GoalDetailTx } from '../goalDetailShared'
import type { FundBreakdownItem } from '../../DashboardClient'

const baseTx = (over: Partial<GoalDetailTx>): GoalDetailTx => ({
  transaction_id: 't', transaction_type: 'investment', asset_type: 'gold',
  fund_id: null, investment_date: '2026-01-01', amount_vnd: 0, units: null,
  interest_rate: null, notes: null, principal_withdrawn: null, units_withdrawn: null,
  ...over,
})

const fund: FundBreakdownItem = {
  fundId: 'f1', fundName: 'VESAF', fundType: 'equity', quantity: 100,
  currentNAV: 25_000, currentValue: 2_500_000, purchasePrice: 22_000,
  profitLoss: 300_000, profitLossPercentage: 13.64, goalId: 'g1',
} as FundBreakdownItem

describe('buildInvRows', () => {
  it('values gold at the live price per chỉ, net of withdrawn units (issue #251)', () => {
    const rows = buildInvRows(
      [baseTx({ transaction_id: 'g1', asset_type: 'gold', amount_vnd: 9_000_000, units: 1 })],
      [], 9_200_000, false,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].value).toBe(9_200_000)         // 1 chỉ × current price
    expect(rows[0].units).toBe(1)
    expect(rows[0].principal).toBe(9_000_000)     // cost basis preserved
  })

  it('falls back to cost when no gold price is available', () => {
    const rows = buildInvRows(
      [baseTx({ transaction_id: 'g1', asset_type: 'gold', amount_vnd: 9_000_000, units: 1 })],
      [], null, false,
    )
    expect(rows[0].value).toBe(9_000_000)
  })

  it('compounds bank interest monthly and reports principal', () => {
    const rows = buildInvRows(
      [baseTx({ transaction_id: 'b1', asset_type: 'bank', amount_vnd: 5_000_000, interest_rate: 6 })],
      [], null, false,
    )
    expect(rows[0].value).toBeGreaterThanOrEqual(5_000_000)
    expect(rows[0].principal).toBe(5_000_000)
    expect(rows[0].units).toBeNull()
  })

  it('uses the fund current value and dedups multiple txs of the same fund', () => {
    const rows = buildInvRows(
      [
        baseTx({ transaction_id: 'x1', asset_type: 'fund', fund_id: 'f1', amount_vnd: 1_000_000 }),
        baseTx({ transaction_id: 'x2', asset_type: 'fund', fund_id: 'f1', amount_vnd: 1_000_000 }),
      ],
      [fund], null, false,
    )
    expect(rows).toHaveLength(1)               // one row per fund
    expect(rows[0].value).toBe(2_500_000)      // fund.currentValue
    expect(rows[0].fund?.fundId).toBe('f1')
  })

  it('drops withdrawal rows', () => {
    const rows = buildInvRows(
      [
        baseTx({ transaction_id: 'g1', asset_type: 'gold', amount_vnd: 9_000_000, units: 1 }),
        baseTx({ transaction_id: 'w1', transaction_type: 'withdrawal', asset_type: 'gold' }),
      ],
      [], 9_200_000, false,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('g1')
  })

  it('localises bank/gold names when isVi', () => {
    const rows = buildInvRows(
      [baseTx({ transaction_id: 'g1', asset_type: 'gold', amount_vnd: 1, units: 1, notes: null })],
      [], 9_200_000, true,
    )
    expect(rows[0].name).toBe('Vàng')
  })
})

describe('calcDeadlineMonths', () => {
  it('defaults to 12 when no target date', () => {
    expect(calcDeadlineMonths(null)).toBe(12)
  })
  it('never returns below 1', () => {
    expect(calcDeadlineMonths('2000-01')).toBe(1)
  })
})
