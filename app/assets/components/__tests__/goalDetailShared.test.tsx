import { describe, it, expect, afterEach, vi } from 'vitest'
import { type GoalDetailTx } from '../goalDetailShared'
import { buildInvRows, buildRenewalSummary } from '../goalDetailRows'
import { fmtMaturity } from '../goalDetailMaturity'
import { calcDeadlineMonths, computeGoalCalculator, describeHistoryRow, mergedFromLabel } from '../goalDetailModel'
import type { FundBreakdownItem } from '@/features/dashboard/contracts'
import { ArrowUpRight, ArrowDownRight, PiggyBank, GitMerge, RefreshCw } from 'lucide-react'
import { todayIso, addDaysIso } from '@/lib/dates'

// A YYYY-MM-DD string `n` days from today (deterministic regardless of run date).
// Built on the BUSINESS calendar, because that is what daysUntil/fmtMaturity
// measure against. Deriving these from the runtime's local clock made every
// maturity assertion off by one whenever the runner's date differed from
// Vietnam's — on a UTC runner, that is 17:00–23:59 every day (#591).
function daysFromNow(n: number): string {
  return addDaysIso(todayIso(), n)
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

  it('values a bank deposit at principal + accrued interest and reports principal', () => {
    const rows = buildInvRows(
      [baseTx({ transaction_id: 'b1', asset_type: 'bank', amount_vnd: 5_000_000, interest_rate: 6 })],
      [], null, false,
    )
    expect(rows[0].value).toBeGreaterThanOrEqual(5_000_000)
    expect(rows[0].principal).toBe(5_000_000)
    expect(rows[0].units).toBeNull()
  })

  it('carries bank_code through to InvRow.bankCode for bank deposits (null for non-bank)', () => {
    const rows = buildInvRows(
      [
        baseTx({ transaction_id: 'b1', asset_type: 'bank', amount_vnd: 5_000_000, interest_rate: 6, bank_code: 'VCB' }),
        baseTx({ transaction_id: 'g1', asset_type: 'gold', amount_vnd: 9_000_000, units: 1 }),
      ],
      [], 9_200_000, false,
    )
    const bank = rows.find((r) => r.id === 'b1')!
    const gold = rows.find((r) => r.id === 'g1')!
    expect(bank.bankCode).toBe('VCB')
    expect(gold.bankCode ?? null).toBeNull() // structured bank only applies to bank deposits
  })

  it('carries currency + is_pledged through to InvRow for the merge eligibility rules', () => {
    const rows = buildInvRows(
      [
        baseTx({ transaction_id: 'usd', asset_type: 'bank', amount_vnd: 5_000_000, interest_rate: 6, currency: 'USD' }),
        baseTx({ transaction_id: 'pledged', asset_type: 'bank', amount_vnd: 7_000_000, interest_rate: 6, is_pledged: true }),
        baseTx({ transaction_id: 'legacy', asset_type: 'bank', amount_vnd: 3_000_000, interest_rate: 6 }),
      ],
      [], null, false,
    )
    const usd = rows.find((r) => r.id === 'usd')!
    const pledged = rows.find((r) => r.id === 'pledged')!
    const legacy = rows.find((r) => r.id === 'legacy')!
    expect(usd.currency).toBe('USD')
    expect(pledged.isPledged).toBe(true)
    // Legacy deposits predate the columns — default to VND / not pledged.
    expect(legacy.currency ?? 'VND').toBe('VND')
    expect(legacy.isPledged ?? false).toBe(false)
  })

  it('uses the anchor tranche bank_code for an accumulating book row', () => {
    const rows = buildInvRows(
      [
        baseTx({ transaction_id: 'book', asset_type: 'bank', amount_vnd: 2_000_000, interest_rate: 6, deposit_group_id: 'book', bank_code: 'MB', investment_date: daysFromNow(-30) }),
        baseTx({ transaction_id: 'tr2', asset_type: 'bank', amount_vnd: 1_000_000, interest_rate: 6, deposit_group_id: 'book', bank_code: 'MB', investment_date: daysFromNow(-10) }),
      ],
      [], null, false,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].depositGroupId).toBe('book')
    expect(rows[0].bankCode).toBe('MB')
  })

  // #638 Phase 4. After a book is folded into its successor, the successor holds
  // a tranche that came from somewhere else entirely, and the source is gone from
  // the holdings list — dissolved. Without saying where that money came from, the
  // new book just grows by an unexplained amount on a date nothing else marks.
  it('names the book a credited tranche was folded in from', () => {
    const rows = buildInvRows(
      [
        baseTx({ transaction_id: 'B', asset_type: 'bank', amount_vnd: 2_000_000, interest_rate: 5, deposit_group_id: 'B', notes: 'PVcomBank B', investment_date: daysFromNow(-60) }),
        baseTx({ transaction_id: 'credited', asset_type: 'bank', amount_vnd: 8_300_000, interest_rate: 5, deposit_group_id: 'B', investment_date: daysFromNow(-1), merged_from_book_id: 'A' }),
        // A's anchor still exists — closed and dissolved, so it is no longer a
        // holding, but it is what carries the name the user knew it by.
        baseTx({ transaction_id: 'A', asset_type: 'bank', amount_vnd: 8_000_000, interest_rate: 4, notes: 'PVcomBank A', investment_date: daysFromNow(-300), principal_withdrawn: null }),
        baseTx({ transaction_id: 'w', transaction_type: 'withdrawal', asset_type: 'bank', parent_transaction_id: 'A', amount_vnd: 8_300_000, principal_withdrawn: 8_000_000, investment_date: daysFromNow(-1) }),
      ],
      [], null, false,
    )
    const book = rows.find((r) => r.depositGroupId === 'B')!
    const credited = book.tranches!.find((t) => t.id === 'credited')!
    expect(credited.mergedFrom).toBe('PVcomBank A')
    // The ordinary tranche says nothing.
    expect(book.tranches!.find((t) => t.id === 'B')!.mergedFrom).toBeFalsy()
  })

  // On a goal past the 200-row page the source is fetched for its name alone and
  // deliberately kept out of the holdings input — it is a closed row whose own
  // closing withdrawal may be off the page, and counting it here would show the
  // money twice. The name still has to arrive.
  it('names a source that was fetched for its name alone', () => {
    const rows = buildInvRows(
      [
        baseTx({ transaction_id: 'B', asset_type: 'bank', amount_vnd: 2_000_000, interest_rate: 5, deposit_group_id: 'B', notes: 'PVcomBank B', investment_date: daysFromNow(-60) }),
        baseTx({ transaction_id: 'credited', asset_type: 'bank', amount_vnd: 8_300_000, interest_rate: 5, deposit_group_id: 'B', investment_date: daysFromNow(-1), merged_from_book_id: 'A' }),
      ],
      [], null, false, { A: 'PVcomBank A' },
    )
    const book = rows.find((r) => r.depositGroupId === 'B')!
    expect(book.tranches!.find((t) => t.id === 'credited')!.mergedFrom).toBe('PVcomBank A')
    // ...and the source is not a holding of its own.
    expect(rows.some((r) => r.id === 'A')).toBe(false)
  })

  it('names the successor a promised book is waiting to be folded into', () => {
    const rows = buildInvRows(
      [
        baseTx({ transaction_id: 'A', asset_type: 'bank', amount_vnd: 8_000_000, interest_rate: 4, deposit_group_id: 'A', notes: 'PVcomBank A', investment_date: daysFromNow(-300), successor_deposit_tx_id: 'B' }),
        baseTx({ transaction_id: 'B', asset_type: 'bank', amount_vnd: 2_000_000, interest_rate: 5, deposit_group_id: 'B', notes: 'PVcomBank B', investment_date: daysFromNow(-60) }),
      ],
      [], null, false,
    )
    expect(rows.find((r) => r.depositGroupId === 'A')!.successorName).toBe('PVcomBank B')
  })

  it('caps a matured deposit at its term interest (frozen, simple interest)', () => {
    // Term 2025-01-01 → 2025-07-01 (181 days). Interest is capped at maturity, so
    // the value is deterministic regardless of when the test runs (today is past
    // the expiry): 10M + 10M × 6% × 181/365.
    const rows = buildInvRows(
      [baseTx({ transaction_id: 'm1', asset_type: 'bank', amount_vnd: 10_000_000, interest_rate: 6, investment_date: '2025-01-01', expiry_date: '2025-07-01' })],
      [], null, false,
    )
    const expected = Math.round(10_000_000 + 10_000_000 * 0.06 * (181 / 365))
    expect(rows[0].value).toBe(expected)
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

  it('summarises a deposit\'s renewal history (count + total interest received)', () => {
    const txs = [
      baseTx({ transaction_id: 'active', asset_type: 'bank', amount_vnd: 12_000_000 }),
      baseTx({ transaction_id: 's1', asset_type: 'bank', amount_vnd: 10_000_000, renewed_from_transaction_id: 'active', interest_earned_vnd: 600_000 }),
      baseTx({ transaction_id: 's2', asset_type: 'bank', amount_vnd: 11_000_000, renewed_from_transaction_id: 'active', interest_earned_vnd: 660_000 }),
    ]
    const summary = buildRenewalSummary(txs, 'active')
    expect(summary).toEqual({ count: 2, totalInterestVnd: 1_260_000, complete: true })
  })

  it('marks the renewal total incomplete when a cycle has no recorded interest (null != 0)', () => {
    const txs = [
      baseTx({ transaction_id: 's1', asset_type: 'bank', renewed_from_transaction_id: 'active', interest_earned_vnd: 600_000 }),
      baseTx({ transaction_id: 's2', asset_type: 'bank', renewed_from_transaction_id: 'active', interest_earned_vnd: null }),
    ]
    const summary = buildRenewalSummary(txs, 'active')
    expect(summary).toEqual({ count: 2, totalInterestVnd: 600_000, complete: false })
  })

  it('returns null when a deposit has never been renewed', () => {
    expect(buildRenewalSummary([baseTx({ transaction_id: 'active', asset_type: 'bank' })], 'active')).toBeNull()
  })

  it('drops renewal history snapshots (renewed_from_transaction_id set) from active holdings', () => {
    const rows = buildInvRows(
      [
        baseTx({ transaction_id: 'active', asset_type: 'bank', amount_vnd: 10_000_000, interest_rate: 6 }),
        // A past-cycle snapshot of the same deposit — must not appear as a holding.
        baseTx({ transaction_id: 'snap', asset_type: 'bank', amount_vnd: 9_000_000, interest_rate: 5.5, renewed_from_transaction_id: 'active' }),
      ],
      [], null, false,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('active')
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

// A recurring saving is a plan definition with no investment_transactions row.
// The goal-detail load merges the API's synthesized per-month rows
// (`recurring:<savingId>:<date>`) into the same list, so without special handling
// they render as ordinary holdings — and withdrawing one posts that synthetic id
// as parent_transaction_id, which the API rejects outright (#640).
describe('buildInvRows — synthesized recurring contributions (#640)', () => {
  const rec = (over: Partial<GoalDetailTx>): GoalDetailTx => baseTx({
    asset_type: 'bank', notes: 'PVComBank', is_recurring: true, ...over,
  })

  it('rolls every realized month of one recurring saving into a single row', () => {
    const rows = buildInvRows(
      [
        rec({ transaction_id: 'recurring:s1:2026-06-01', investment_date: '2026-06-01', amount_vnd: 5_000_000 }),
        rec({ transaction_id: 'recurring:s1:2026-07-01', investment_date: '2026-07-01', amount_vnd: 5_000_000 }),
      ],
      [], null, true,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('PVComBank')
    expect(rows[0].value).toBe(10_000_000)     // the goal really holds both months
    expect(rows[0].principal).toBe(10_000_000)
    expect(rows[0].investmentDate).toBe('2026-06-01') // the first month contributed
  })

  it('flags the row as recurring so the UI can withhold the transaction-only actions', () => {
    const rows = buildInvRows(
      [rec({ transaction_id: 'recurring:s1:2026-06-01', amount_vnd: 5_000_000 })],
      [], null, true,
    )
    expect(rows[0].isRecurring).toBe(true)
    // No transaction backs it: nothing here may be posted as a parent id.
    expect(rows[0].depositGroupId ?? null).toBeNull()
    expect(rows[0].expiryDate).toBeNull()
  })

  it('keeps each recurring saving separate and never folds one into a real deposit', () => {
    const rows = buildInvRows(
      [
        baseTx({ transaction_id: 'b1', asset_type: 'bank', amount_vnd: 20_000_000, interest_rate: 0, notes: 'PVComBank' }),
        rec({ transaction_id: 'recurring:s1:2026-06-01', amount_vnd: 5_000_000 }),
        rec({ transaction_id: 'recurring:s2:2026-06-01', notes: 'VCB định kỳ', amount_vnd: 1_000_000 }),
      ],
      [], null, true,
    )
    expect(rows).toHaveLength(3)
    const real = rows.find((r) => r.id === 'b1')!
    expect(real.isRecurring ?? false).toBe(false) // a real deposit stays actionable
    expect(real.value).toBe(20_000_000)
    expect(rows.filter((r) => r.isRecurring)).toHaveLength(2)
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

  it('says "Matured" once the date has passed, flagged as needing action (neg)', () => {
    const m = fmtMaturity(daysFromNow(-5), false)!
    expect(m.relative).toBe('Matured')
    expect(m.tone).toBe('neg') // red, consistent with the maturity card / resolve pill (not green)
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

// The projection math the mobile sheet and desktop panel both ran inline (#467).
// targetDate:null pins monthsLeft to 12 so every assertion below is deterministic.
describe('computeGoalCalculator', () => {
  it('derives remaining, min-per-month, and projection from the monthly input', () => {
    const c = computeGoalCalculator({ targetAmount: 120_000_000, targetDate: null, currentValue: 0 }, 10_000_000)
    expect(c.remaining).toBe(120_000_000)
    expect(c.monthsLeft).toBe(12)
    expect(c.neededPerMonth).toBe(10_000_000)   // 120M / 12
    expect(c.monthsToGoal).toBe(12)             // ceil(120M / 10M)
    expect(c.projectedDate).toBeInstanceOf(Date)
    expect(c.isOnTrack).toBe(true)              // 10M >= 10M needed
    expect(c.gap).toBe(0)
  })

  it('flags behind-schedule when the input is under the needed monthly amount', () => {
    const c = computeGoalCalculator({ targetAmount: 120_000_000, targetDate: null, currentValue: 0 }, 5_000_000)
    expect(c.monthsToGoal).toBe(24)             // ceil(120M / 5M)
    expect(c.isOnTrack).toBe(false)             // 5M < 10M
    expect(c.gap).toBe(5_000_000)
  })

  // The projection is rendered as a month and year, so landing in the wrong month
  // is the whole error. Adding months to TODAY's date overflows whenever today's
  // day doesn't exist in the target month: on the 31st, "seven months from now" is
  // 31 February, which JavaScript silently rolls into March. The user is told a
  // month later than the pace actually reaches the goal, and only on the 29th-31st,
  // which is why it went unnoticed.
  describe('projected month across a short month (run-date dependent)', () => {
    afterEach(() => vi.useRealTimers())

    it('lands in February when seven months from 31 July', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-07-31T05:00:00Z'))   // 31 July 2026, 12:00 in Vietnam

      const c = computeGoalCalculator({ targetAmount: 7_000_000, targetDate: null, currentValue: 0 }, 1_000_000)

      expect(c.monthsToGoal).toBe(7)
      expect(c.projectedDate?.getFullYear()).toBe(2027)
      expect(c.projectedDate?.getMonth()).toBe(1)   // February, not March
    })

    it('lands in the next month when one month from 31 January', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-31T05:00:00Z'))   // 31 January 2026, 12:00 in Vietnam

      const c = computeGoalCalculator({ targetAmount: 1_000_000, targetDate: null, currentValue: 0 }, 1_000_000)

      expect(c.projectedDate?.getMonth()).toBe(1)   // February, not March
    })
  })

  it('returns no projection (null) when the input is zero', () => {
    const c = computeGoalCalculator({ targetAmount: 120_000_000, targetDate: null, currentValue: 0 }, 0)
    expect(c.monthsToGoal).toBeNull()
    expect(c.projectedDate).toBeNull()
    expect(c.isOnTrack).toBe(false)
  })

  it('clamps remaining/needed to zero once the goal is already met', () => {
    const c = computeGoalCalculator({ targetAmount: 50_000_000, targetDate: null, currentValue: 80_000_000 }, 1_000_000)
    expect(c.remaining).toBe(0)
    expect(c.neededPerMonth).toBe(0)
    expect(c.monthsToGoal).toBeNull()           // nothing left to project
  })

  it('treats a missing target amount as no remaining', () => {
    const c = computeGoalCalculator({ targetAmount: null, targetDate: null, currentValue: 10_000_000 }, 1_000_000)
    expect(c.remaining).toBe(0)
    expect(c.neededPerMonth).toBe(0)
  })
})


// The transaction-history row's classifier (#467): kind → colour tokens, icon,
// amount sign and display name. Was byte-identical inline in GoalDetailSheet and
// DesktopGoalDetail; both now call this so the two surfaces can't drift.
describe('describeHistoryRow', () => {
  it('an investment reads positive (green, up-arrow, +)', () => {
    const d = describeHistoryRow({ transaction_type: 'investment', fund_name: 'VESAF' }, false, false)
    expect(d.kind).toBe('investment')
    expect(d.ink).toBe('var(--c-pos)')
    expect(d.fill).toBe('var(--c-pos-tint)')
    expect(d.Icon).toBe(ArrowUpRight)
    expect(d.sign).toBe('+')
    expect(d.name).toBe('VESAF')
  })

  it('a real withdrawal reads negative (red, down-arrow, -)', () => {
    const d = describeHistoryRow({ transaction_type: 'withdrawal', notes: 'Sell' }, false, false)
    expect(d.kind).toBe('withdrawal')
    expect(d.ink).toBe('var(--c-neg)')
    expect(d.fill).toBe('var(--c-neg-tint)')
    expect(d.Icon).toBe(ArrowDownRight)
    expect(d.sign).toBe('-')
    expect(d.name).toBe('Sell')
  })

  it('a held-for-merge settlement reads neutral (muted, piggy-bank, no sign)', () => {
    const d = describeHistoryRow({ transaction_type: 'withdrawal', held_for_merge: true }, false, false)
    expect(d.kind).toBe('held')
    expect(d.ink).toBe('var(--c-muted)')
    expect(d.fill).toBe('var(--c-card-2)')
    expect(d.Icon).toBe(PiggyBank)
    expect(d.sign).toBe('')
  })

  it('a consumed (merged) settlement uses the merge icon, still neutral', () => {
    const d = describeHistoryRow({ transaction_type: 'withdrawal', held_for_merge: true, consumed_by_inv_id: 'x' }, false, false)
    expect(d.kind).toBe('consumed')
    expect(d.Icon).toBe(GitMerge)
    expect(d.ink).toBe('var(--c-muted)')
    expect(d.sign).toBe('')
  })

  it('a renewed row reads neutral with the renew icon but keeps its + sign', () => {
    const d = describeHistoryRow({ transaction_type: 'investment', fund_name: 'VESAF' }, true, false)
    expect(d.Icon).toBe(RefreshCw)
    expect(d.ink).toBe('var(--c-muted)')   // renewed → neutral
    expect(d.sign).toBe('+')               // still an investment
  })

  it('falls back name to notes then a localized default', () => {
    expect(describeHistoryRow({ transaction_type: 'investment', notes: 'Cash' }, false, false).name).toBe('Cash')
    expect(describeHistoryRow({ transaction_type: 'investment' }, false, false).name).toBe('Investment')
    expect(describeHistoryRow({ transaction_type: 'investment' }, false, true).name).toBe('Khoản đầu tư')
  })
})

// #656: a credited tranche's "Gộp từ <A>" used to die with the successor's first
// renewal — the tranche is deleted and the book stops being a book, so the top-up
// strip that hosted the label is gone. The marker now rides onto the renewal
// snapshot, and the History row is where it gets said.
describe('mergedFromLabel', () => {
  const names = { 'book-a': 'PVcomBank A' }

  it('names the book a renewal snapshot was paid for by', () => {
    const tx = { merged_from_book_id: 'book-a' }
    expect(mergedFromLabel(tx, names, true)).toBe('Gộp từ PVcomBank A')
    expect(mergedFromLabel(tx, names, false)).toBe('Merged from PVcomBank A')
  })

  it('says nothing for a row no book paid for', () => {
    expect(mergedFromLabel({}, names, false)).toBeNull()
    expect(mergedFromLabel({ merged_from_book_id: null }, names, false)).toBeNull()
  })

  // The source is dissolved by the merge, so its name comes from the page's
  // book-name map — and a source on a goal past the page falls out of it.
  // useGoalDetailData backfills those by id, but a miss must still read as
  // provenance rather than as "Merged from undefined".
  it('falls back to an anonymous source rather than an empty name', () => {
    expect(mergedFromLabel({ merged_from_book_id: 'gone' }, names, false)).toBe('Merged from another book')
    expect(mergedFromLabel({ merged_from_book_id: 'gone' }, names, true)).toBe('Gộp từ một sổ khác')
  })
})
