import { describe, it, expect } from 'vitest'
import { buildInvRows, calcDeadlineMonths, fmtMaturity, type GoalDetailTx } from '../goalDetailShared'
import type { FundBreakdownItem } from '../../DashboardClient'

// A YYYY-MM-DD string `n` days from today (deterministic regardless of run date).
function daysFromNow(n: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const baseTx = (over: Partial<GoalDetailTx>): GoalDetailTx => ({
  transaction_id: 't', transaction_type: 'investment', asset_type: 'gold',
  fund_id: null, investment_date: '2026-01-01', amount_vnd: 0, units: null,
  interest_rate: null, notes: null, principal_withdrawn: null, units_withdrawn: null,
  parent_transaction_id: null,
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

  it('nets a partial bank withdrawal against principal (issue #261)', () => {
    const rows = buildInvRows(
      [
        baseTx({ transaction_id: 'b1', asset_type: 'bank', amount_vnd: 10_000_000, interest_rate: 0 }),
        baseTx({ transaction_id: 'w1', transaction_type: 'withdrawal', asset_type: 'bank', parent_transaction_id: 'b1', amount_vnd: 4_000_000, principal_withdrawn: 4_000_000 }),
      ],
      [], null, false,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('b1')
    expect(rows[0].principal).toBe(6_000_000)
    expect(rows[0].value).toBe(6_000_000)
  })

  it('drops a fully-withdrawn bank deposit (issue #261)', () => {
    const rows = buildInvRows(
      [
        baseTx({ transaction_id: 'b1', asset_type: 'bank', amount_vnd: 10_000_000, interest_rate: 6 }),
        baseTx({ transaction_id: 'w1', transaction_type: 'withdrawal', asset_type: 'bank', parent_transaction_id: 'b1', amount_vnd: 10_500_000, principal_withdrawn: 10_000_000 }),
      ],
      [], null, false,
    )
    expect(rows).toHaveLength(0)
  })

  it('nets a partial gold sale from a withdrawal row (issue #261)', () => {
    const rows = buildInvRows(
      [
        baseTx({ transaction_id: 'g1', asset_type: 'gold', amount_vnd: 18_000_000, units: 2 }),
        baseTx({ transaction_id: 'w1', transaction_type: 'withdrawal', asset_type: 'gold', parent_transaction_id: 'g1', amount_vnd: 9_200_000, units_withdrawn: 1, principal_withdrawn: 9_000_000 }),
      ],
      [], 9_200_000, false,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].units).toBe(1)
    expect(rows[0].value).toBe(9_200_000)     // 1 chỉ left × current price
    expect(rows[0].principal).toBe(9_000_000) // remaining cost basis
  })

  it('drops a fully-sold gold holding (issue #261)', () => {
    const rows = buildInvRows(
      [
        baseTx({ transaction_id: 'g1', asset_type: 'gold', amount_vnd: 9_000_000, units: 1 }),
        baseTx({ transaction_id: 'w1', transaction_type: 'withdrawal', asset_type: 'gold', parent_transaction_id: 'g1', amount_vnd: 9_200_000, units_withdrawn: 1, principal_withdrawn: 9_000_000 }),
      ],
      [], 9_200_000, false,
    )
    expect(rows).toHaveLength(0)
  })

  it('localises bank/gold names when isVi', () => {
    const rows = buildInvRows(
      [baseTx({ transaction_id: 'g1', asset_type: 'gold', amount_vnd: 1, units: 1, notes: null })],
      [], 9_200_000, true,
    )
    expect(rows[0].name).toBe('Vàng')
  })

  it('carries the bank deposit maturity (expiry_date) through to the row (issue #263)', () => {
    const rows = buildInvRows(
      [baseTx({ transaction_id: 'b1', asset_type: 'bank', amount_vnd: 5_000_000, interest_rate: 6, expiry_date: '2026-08-15' })],
      [], null, false,
    )
    expect(rows[0].expiryDate).toBe('2026-08-15')
  })

  it('leaves expiryDate null when the deposit has no maturity', () => {
    const rows = buildInvRows(
      [baseTx({ transaction_id: 'b1', asset_type: 'bank', amount_vnd: 5_000_000, interest_rate: 6 })],
      [], null, false,
    )
    expect(rows[0].expiryDate).toBeNull()
  })
})

describe('fmtMaturity (issue #263)', () => {
  it('returns null for a missing date', () => {
    expect(fmtMaturity(null, false)).toBeNull()
    expect(fmtMaturity('', false)).toBeNull()
  })

  it('formats the maturity date as "DD Mon YYYY"', () => {
    expect(fmtMaturity('2026-08-15', false)?.formatted).toBe('15 Aug 2026')
  })

  it('counts down the days left and stays neutral when far out', () => {
    const m = fmtMaturity(daysFromNow(200), false)!
    expect(m.diffDays).toBe(200)
    expect(m.relative).toBe('200 days left')
    expect(m.tone).toBe('neutral')
  })

  it('warns when maturity is within 30 days', () => {
    const m = fmtMaturity(daysFromNow(10), false)!
    expect(m.relative).toBe('10 days left')
    expect(m.tone).toBe('warn')
  })

  it('uses the singular "1 day left"', () => {
    expect(fmtMaturity(daysFromNow(1), false)!.relative).toBe('1 day left')
  })

  it('says "Matures today" on the maturity day', () => {
    const m = fmtMaturity(daysFromNow(0), false)!
    expect(m.relative).toBe('Matures today')
    expect(m.tone).toBe('warn')
  })

  it('says "Matured" once the date has passed', () => {
    const m = fmtMaturity(daysFromNow(-5), false)!
    expect(m.relative).toBe('Matured')
    expect(m.tone).toBe('pos')
  })

  it('localises the relative text in Vietnamese', () => {
    expect(fmtMaturity(daysFromNow(10), true)!.relative).toBe('Còn 10 ngày')
    expect(fmtMaturity(daysFromNow(-5), true)!.relative).toBe('Đã đáo hạn')
    expect(fmtMaturity(daysFromNow(0), true)!.relative).toBe('Đáo hạn hôm nay')
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
