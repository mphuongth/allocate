import { describe, it, expect, vi, afterEach } from 'vitest'
import { realizedRecurringContributions } from '../finance'

// "Now" is fixed to 8 Jun 2026 for every test: months <= 2026-06 are realized.
function freezeJun2026() {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 5, 8)) // 8 Jun 2026
}

const saving = (over: Partial<Parameters<typeof realizedRecurringContributions>[0][number]> = {}) => ({
  saving_id: 's1',
  goal_id: 'g1',
  name: 'VCB Savings',
  amount_vnd: 5_000_000,
  effective_from: null,
  effective_to: null,
  ...over,
})

const plan = (id: string, year: number, month: number) => ({ id, year, month })

describe('realizedRecurringContributions', () => {
  afterEach(() => vi.useRealTimers())

  it('emits one contribution per realized plan-month for an always-active saving', () => {
    freezeJun2026()
    const rows = realizedRecurringContributions(
      [saving()],
      [plan('p-may', 2026, 5), plan('p-jun', 2026, 6)],
      [],
    )
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.date).sort()).toEqual(['2026-05-01', '2026-06-01'])
    expect(rows.every((r) => r.amount === 5_000_000)).toBe(true)
    expect(rows.every((r) => r.goalId === 'g1' && r.name === 'VCB Savings')).toBe(true)
  })

  it('excludes future (not-yet-realized) plan months', () => {
    freezeJun2026()
    const rows = realizedRecurringContributions(
      [saving()],
      [plan('p-jul', 2026, 7), plan('p-aug', 2026, 8)],
      [],
    )
    expect(rows).toHaveLength(0)
  })

  it('respects the effective_from / effective_to window at month granularity', () => {
    freezeJun2026()
    const rows = realizedRecurringContributions(
      [saving({ effective_from: '2026-05-01', effective_to: '2026-05-01' })],
      [plan('p-apr', 2026, 4), plan('p-may', 2026, 5), plan('p-jun', 2026, 6)],
      [],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].date).toBe('2026-05-01')
  })

  it('treats an override of 0 as a skipped month (no row)', () => {
    freezeJun2026()
    const rows = realizedRecurringContributions(
      [saving()],
      [plan('p-may', 2026, 5), plan('p-jun', 2026, 6)],
      [{ plan_id: 'p-may', recurring_saving_id: 's1', monthly_amount_override_vnd: 0 }],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].date).toBe('2026-06-01')
    expect(rows[0].amount).toBe(5_000_000)
  })

  it('uses a positive override amount in place of the base amount', () => {
    freezeJun2026()
    const rows = realizedRecurringContributions(
      [saving()],
      [plan('p-may', 2026, 5)],
      [{ plan_id: 'p-may', recurring_saving_id: 's1', monthly_amount_override_vnd: 2_000_000 }],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].amount).toBe(2_000_000)
  })

  it('returns unallocated savings with a null goalId', () => {
    freezeJun2026()
    const rows = realizedRecurringContributions(
      [saving({ goal_id: null })],
      [plan('p-may', 2026, 5)],
      [],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].goalId).toBeNull()
  })

  it('returns nothing when there are no plans', () => {
    freezeJun2026()
    expect(realizedRecurringContributions([saving()], [], [])).toEqual([])
  })

  it('carries the originating savingId and planId for traceability', () => {
    freezeJun2026()
    const rows = realizedRecurringContributions([saving()], [plan('p-may', 2026, 5)], [])
    expect(rows[0].savingId).toBe('s1')
    expect(rows[0].planId).toBe('p-may')
  })
})
