import { describe, it, expect } from 'vitest'
import {
  resolveRecurringSavings,
  recurringSavingsTotal,
  buildByGoal,
  type RecurringSaving,
  type RecurringSavingOverride,
  type GoalInvestment,
  type GoalDirectSaving,
} from '../planning'

function saving(o: Partial<RecurringSaving> = {}): RecurringSaving {
  return {
    saving_id: 's-1',
    name: 'VCB Savings',
    goal_id: 'g-1',
    amount_vnd: 2_000_000,
    savings_goals: { goal_name: 'Retirement' },
    ...o,
  }
}

describe('resolveRecurringSavings', () => {
  it('uses the base amount when there is no override', () => {
    const [r] = resolveRecurringSavings([saving()], [])
    expect(r.amount).toBe(2_000_000)
    expect(r.skipped).toBe(false)
    expect(r.overridden).toBe(false)
  })

  it('marks a 0 override as skipped with effective amount 0', () => {
    const ov: RecurringSavingOverride = { recurring_saving_id: 's-1', monthly_amount_override_vnd: 0 }
    const [r] = resolveRecurringSavings([saving()], [ov])
    expect(r.skipped).toBe(true)
    expect(r.amount).toBe(0)
  })

  it('applies a positive override and flags it overridden', () => {
    const ov: RecurringSavingOverride = { recurring_saving_id: 's-1', monthly_amount_override_vnd: 5_000_000 }
    const [r] = resolveRecurringSavings([saving()], [ov])
    expect(r.amount).toBe(5_000_000)
    expect(r.overridden).toBe(true)
    expect(r.skipped).toBe(false)
  })

  it('does not flag overridden when the override equals the base amount', () => {
    const ov: RecurringSavingOverride = { recurring_saving_id: 's-1', monthly_amount_override_vnd: 2_000_000 }
    const [r] = resolveRecurringSavings([saving()], [ov])
    expect(r.overridden).toBe(false)
  })
})

describe('recurringSavingsTotal', () => {
  it('sums effective amounts and excludes skipped rows', () => {
    const savings = [
      saving({ saving_id: 's-1', amount_vnd: 2_000_000 }),
      saving({ saving_id: 's-2', amount_vnd: 3_000_000 }),
    ]
    const overrides = [{ recurring_saving_id: 's-2', monthly_amount_override_vnd: 0 }]
    const resolved = resolveRecurringSavings(savings, overrides)
    expect(recurringSavingsTotal(resolved)).toBe(2_000_000)
  })
})

describe('buildByGoal', () => {
  const goalsById = new Map([['g-1', 'Retirement'], ['g-2', 'House']])

  it('groups fund investments, one-off savings and recurring savings under one goal', () => {
    const investments: GoalInvestment[] = [
      { goal_id: 'g-1', amount_vnd: 5_000_000, is_dca_seeded: true, funds: { name: 'VESAF' }, savings_goals: { goal_name: 'Retirement' } },
    ]
    const directSavings: GoalDirectSaving[] = [
      { goal_id: 'g-1', amount_vnd: 1_000_000, savings_goals: { goal_name: 'Retirement' } },
    ]
    const recurring = resolveRecurringSavings([saving({ goal_id: 'g-1', amount_vnd: 2_000_000 })], [])

    const rows = buildByGoal(investments, directSavings, recurring, goalsById)
    expect(rows).toHaveLength(1)
    expect(rows[0].goalName).toBe('Retirement')
    expect(rows[0].totalAllocated).toBe(8_000_000)
    expect(rows[0].items.map(i => i.type)).toEqual(['fund', 'bank', 'bank'])
  })

  it('excludes skipped recurring savings from the goal total', () => {
    const recurring = resolveRecurringSavings(
      [saving({ goal_id: 'g-2', amount_vnd: 4_000_000 })],
      [{ recurring_saving_id: 's-1', monthly_amount_override_vnd: 0 }],
    )
    const rows = buildByGoal([], [], recurring, goalsById)
    expect(rows[0].totalAllocated).toBe(0)
    expect(rows[0].items[0].skipped).toBe(true)
  })

  it('places the unallocated group (null goal) last', () => {
    const recurring = resolveRecurringSavings(
      [
        saving({ saving_id: 's-u', goal_id: null, name: 'General', amount_vnd: 1_000_000, savings_goals: null }),
        saving({ saving_id: 's-1', goal_id: 'g-1', amount_vnd: 2_000_000 }),
      ],
      [],
    )
    const rows = buildByGoal([], [], recurring, goalsById)
    expect(rows.map(r => r.isUnallocated)).toEqual([false, true])
  })
})
