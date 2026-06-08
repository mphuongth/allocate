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

describe('buildByGoal — planned vs contributed', () => {
  const goalsById = new Map([['g-1', 'Retirement'], ['g-2', 'House']])

  function dca(o: Partial<GoalInvestment> = {}): GoalInvestment {
    return {
      goal_id: 'g-1',
      amount_vnd: 5_000_000,
      is_dca_seeded: true,
      units: null,
      fund_id: 'f-1',
      transaction_id: 'tx-1',
      funds: { name: 'VESAF' },
      savings_goals: { goal_name: 'Retirement' },
      ...o,
    }
  }

  it('plans fund DCA + recurring savings; recorded buys count as contributed', () => {
    const investments = [dca({ amount_vnd: 5_000_000, units: 100 })] // recorded → contributed
    const recurring = resolveRecurringSavings([saving({ goal_id: 'g-1', amount_vnd: 2_000_000 })], [])
    const [row] = buildByGoal(investments, [], recurring, goalsById)

    expect(row.goalName).toBe('Retirement')
    expect(row.totalAllocated).toBe(7_000_000) // planned = DCA 5M + recurring 2M
    expect(row.contributed).toBe(5_000_000)    // recorded DCA buy
    expect(row.items.map(i => i.type)).toEqual(['fund', 'bank'])
    expect(row.items[0].recorded).toBe(true)
  })

  it('a pending DCA row is planned but not yet contributed', () => {
    const [row] = buildByGoal([dca({ units: null })], [], [], goalsById)
    expect(row.totalAllocated).toBe(5_000_000)
    expect(row.contributed).toBe(0)
    expect(row.items[0].recorded).toBe(false)
  })

  it('bank deposits count as contributed but are not planned line items', () => {
    const directSavings: GoalDirectSaving[] = [
      { goal_id: 'g-1', amount_vnd: 3_000_000, savings_goals: { goal_name: 'Retirement' } },
    ]
    const [row] = buildByGoal([], directSavings, [], goalsById)
    expect(row.totalAllocated).toBe(0)        // not planned
    expect(row.contributed).toBe(3_000_000)   // but contributed
    expect(row.items).toHaveLength(0)
  })

  it('ad-hoc fund buys (not DCA) contribute without being planned line items', () => {
    const adhoc = dca({ is_dca_seeded: false, units: 50, amount_vnd: 1_000_000 })
    const [row] = buildByGoal([adhoc], [], [], goalsById)
    expect(row.totalAllocated).toBe(0)
    expect(row.contributed).toBe(1_000_000)
    expect(row.items).toHaveLength(0)
  })

  it('excludes skipped recurring savings from planned', () => {
    const recurring = resolveRecurringSavings(
      [saving({ goal_id: 'g-2', amount_vnd: 4_000_000 })],
      [{ recurring_saving_id: 's-1', monthly_amount_override_vnd: 0 }],
    )
    const [row] = buildByGoal([], [], recurring, goalsById)
    expect(row.totalAllocated).toBe(0)
    expect(row.items[0].skipped).toBe(true)
  })

  it('renders a skipped DCA fund as a struck line with 0 planned', () => {
    const skipped = dca({ skipped: true, amount_vnd: 5_000_000 })
    const [row] = buildByGoal([skipped], [], [], goalsById)
    expect(row.totalAllocated).toBe(0)
    expect(row.items[0].skipped).toBe(true)
    expect(row.items[0].isFundDca).toBe(true)
    expect(row.items[0].amount).toBe(0)
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
