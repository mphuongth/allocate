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

  // The deposit a saving fed was deleted (#655). Most unlinked savings were
  // never linked at all, so only the stamp tells the two apart — without it the
  // plan can either nag everyone or warn nobody.
  it('flags a saving whose linked deposit was deleted', () => {
    const [r] = resolveRecurringSavings([saving({ unlinked_at: '2026-08-12T03:00:00Z', linked_deposit_tx_id: null })], [])
    expect(r.linkLost).toBe(true)
  })

  it('does not flag a saving that was never linked', () => {
    const [r] = resolveRecurringSavings([saving()], [])
    expect(r.linkLost).toBe(false)
  })

  // A stamp left over from an earlier loss says nothing about a saving that now
  // points at a deposit again — the warning has been answered.
  it('does not flag a saving that is linked again', () => {
    const [r] = resolveRecurringSavings([saving({ unlinked_at: '2026-08-12T03:00:00Z', linked_deposit_tx_id: 'tx-9' })], [])
    expect(r.linkLost).toBe(false)
  })

  // The plan page can be paged back through past months. A deposit deleted in
  // August was still linked all through July, so July's plan must not be told
  // otherwise — the badge would be describing a state that month never had.
  it('does not flag months that ended before the deposit was deleted', () => {
    const [r] = resolveRecurringSavings([saving({ unlinked_at: '2026-08-12T03:00:00Z' })], [], '2026-07')
    expect(r.linkLost).toBe(false)
  })

  it('flags the month the deletion happened in', () => {
    const [r] = resolveRecurringSavings([saving({ unlinked_at: '2026-08-12T03:00:00Z' })], [], '2026-08')
    expect(r.linkLost).toBe(true)
  })

  it('flags every month after it', () => {
    const [r] = resolveRecurringSavings([saving({ unlinked_at: '2026-08-12T03:00:00Z' })], [], '2026-09')
    expect(r.linkLost).toBe(true)
  })

  // 01:00 UTC on the 1st is already the 1st in Vietnam, but 18:00 UTC on the
  // 31st of July is the 1st of August there — the month the stamp belongs to is
  // the business month, not the UTC one.
  it('files the stamp under the business month, not the UTC one', () => {
    const [r] = resolveRecurringSavings([saving({ unlinked_at: '2026-07-31T18:00:00Z' })], [], '2026-08')
    expect(r.linkLost).toBe(true)
    const [july] = resolveRecurringSavings([saving({ unlinked_at: '2026-07-31T18:00:00Z' })], [], '2026-07')
    expect(july.linkLost).toBe(false)
  })

  // Which kind of link was lost decides which sentence is true (#655): a book
  // anchor really was taking the monthly contribution; a term deposit never did.
  it('carries whether the lost link was a book', () => {
    const [book] = resolveRecurringSavings([saving({ unlinked_at: '2026-08-12T03:00:00Z', unlinked_from_book: true })], [])
    expect(book.linkLostFromBook).toBe(true)
    const [term] = resolveRecurringSavings([saving({ unlinked_at: '2026-08-12T03:00:00Z', unlinked_from_book: false })], [])
    expect(term.linkLostFromBook).toBe(false)
  })

  // A deposit that was fully withdrawn still exists; one that was deleted does
  // not, and the plan says so in as many words (#650). Rows stamped before the
  // reason column existed were all deletions, which is the only thing that wrote
  // a stamp back then.
  it('carries why the link went, defaulting to a deletion', () => {
    const [closed] = resolveRecurringSavings([saving({ unlinked_at: '2026-08-12T03:00:00Z', unlinked_reason: 'closed' })], [])
    expect(closed.linkLostReason).toBe('closed')
    const [legacy] = resolveRecurringSavings([saving({ unlinked_at: '2026-08-12T03:00:00Z' })], [])
    expect(legacy.linkLostReason).toBe('deleted')
  })

  // Unknown is not false: the repair of a legacy closed book cannot recover
  // whether the target was a book, and null must not read as "term deposit".
  it('leaves an unknown link kind undefined rather than false', () => {
    const [unknown] = resolveRecurringSavings([saving({ unlinked_at: '2026-08-12T03:00:00Z', unlinked_from_book: null })], [])
    expect(unknown.linkLostFromBook).toBeUndefined()
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

  // The plan page is where the user looks month after month, so the lost link
  // has to reach the line item — a warning only the resolver knows about warns
  // nobody (#655).
  it('carries a lost deposit link onto the goal line item', () => {
    const recurring = resolveRecurringSavings(
      [saving({ goal_id: 'g-1', unlinked_at: '2026-08-12T03:00:00Z', linked_deposit_tx_id: null })],
      [],
    )
    const [row] = buildByGoal([], [], recurring, goalsById)
    expect(row.items[0].linkLost).toBe(true)
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

  it('marks a recurring saving recorded when a matching deposit was logged this month', () => {
    const recurring = resolveRecurringSavings([saving({ goal_id: 'g-1', amount_vnd: 2_000_000 })], [])
    const directSavings: GoalDirectSaving[] = [
      { goal_id: 'g-1', amount_vnd: 2_000_000, savings_goals: { goal_name: 'Retirement' } },
    ]
    const [row] = buildByGoal([], directSavings, recurring, goalsById)
    expect(row.totalAllocated).toBe(2_000_000)  // still planned
    expect(row.contributed).toBe(2_000_000)     // deposit logged this month
    expect(row.items).toHaveLength(1)
    expect(row.items[0].isRecurring).toBe(true)
    expect(row.items[0].recorded).toBe(true)    // line reflects the deposit
  })

  it('leaves a recurring saving unrecorded when no matching deposit exists', () => {
    const recurring = resolveRecurringSavings([saving({ goal_id: 'g-1', amount_vnd: 2_000_000 })], [])
    const [row] = buildByGoal([], [], recurring, goalsById)
    expect(row.items[0].recorded).toBeFalsy()
  })

  it('matches one deposit per recurring line (greedy, by amount)', () => {
    const recurring = resolveRecurringSavings([
      saving({ saving_id: 's-1', goal_id: 'g-1', amount_vnd: 2_000_000 }),
      saving({ saving_id: 's-2', goal_id: 'g-1', amount_vnd: 2_000_000 }),
    ], [])
    const directSavings: GoalDirectSaving[] = [
      { goal_id: 'g-1', amount_vnd: 2_000_000, savings_goals: { goal_name: 'Retirement' } },
    ]
    const [row] = buildByGoal([], directSavings, recurring, goalsById)
    expect(row.items.filter(i => i.recorded).length).toBe(1)
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

describe('buildByGoal — fulfillment-based recording', () => {
  const goalsById = new Map([['g-1', 'Retirement']])

  // A recurring can be recorded without a *matchable* plan-scoped deposit — e.g.
  // maturity-combine (its re-deposit isn't plan-scoped) or a book top-up (its
  // tranche IS plan-scoped). The Plan page honors the fulfillment to mark the
  // line recorded; for contributed it must NOT double-count a top-up tranche that
  // already lands in directSavings — only inject the amount for fulfillments with
  // no plan-scoped deposit (countedAsDeposit:false → maturity-combine).
  it('combine: records the line AND injects contributed (no plan-scoped deposit)', () => {
    const recurring = resolveRecurringSavings([saving({ saving_id: 's-1', goal_id: 'g-1', amount_vnd: 1_800_000 })], [])
    const [row] = buildByGoal([], [], recurring, goalsById, undefined,
      new Map([['s-1', { amount: 1_800_000, countedAsDeposit: false }]]))
    expect(row.items[0].recorded).toBe(true)
    expect(row.totalAllocated).toBe(1_800_000) // planned
    expect(row.contributed).toBe(1_800_000)    // fulfilled → 100%, drives the progress bar
  })

  it('combine: injects the fulfillment\'s actual amount, not the planned line amount', () => {
    // A partial maturity-combine: planned 2M, only 1.5M actually folded in.
    const recurring = resolveRecurringSavings([saving({ saving_id: 's-1', goal_id: 'g-1', amount_vnd: 2_000_000 })], [])
    const [row] = buildByGoal([], [], recurring, goalsById, undefined,
      new Map([['s-1', { amount: 1_500_000, countedAsDeposit: false }]]))
    expect(row.contributed).toBe(1_500_000)
  })

  it('book top-up: records the line but does NOT double-count (tranche already in contributed)', () => {
    // The top-up RPC logs a plan-scoped bank tranche (in directSavings) AND a
    // fulfillment. contributed must count the amount exactly once — via the
    // tranche — so the fulfillment marks recorded only (countedAsDeposit:true).
    const recurring = resolveRecurringSavings([saving({ saving_id: 's-1', goal_id: 'g-1', amount_vnd: 1_800_000 })], [])
    const directSavings: GoalDirectSaving[] = [
      { goal_id: 'g-1', amount_vnd: 1_800_000, savings_goals: { goal_name: 'Retirement' } },
    ]
    const [row] = buildByGoal([], directSavings, recurring, goalsById, undefined,
      new Map([['s-1', { amount: 1_800_000, countedAsDeposit: true }]]))
    expect(row.items[0].recorded).toBe(true)
    expect(row.contributed).toBe(1_800_000) // counted once, not 3.6M
  })

  it('leaves a recurring unrecorded when its id is not fulfilled', () => {
    const recurring = resolveRecurringSavings([saving({ saving_id: 's-1', goal_id: 'g-1', amount_vnd: 1_800_000 })], [])
    const [row] = buildByGoal([], [], recurring, goalsById, undefined,
      new Map([['other', { amount: 1_000_000, countedAsDeposit: false }]]))
    expect(row.items[0].recorded).toBeFalsy()
    expect(row.contributed).toBe(0)
  })

  it('does not consume a deposit when the line is already fulfilled, so a sibling line can still match it', () => {
    // Two same-amount lines in one goal; one fulfilled via combine, one deposit logged.
    // The fulfilled line must NOT eat the deposit — the other line should match it.
    const recurring = resolveRecurringSavings([
      saving({ saving_id: 's-1', goal_id: 'g-1', amount_vnd: 2_000_000 }),
      saving({ saving_id: 's-2', goal_id: 'g-1', amount_vnd: 2_000_000 }),
    ], [])
    const directSavings: GoalDirectSaving[] = [
      { goal_id: 'g-1', amount_vnd: 2_000_000, savings_goals: { goal_name: 'Retirement' } },
    ]
    const [row] = buildByGoal([], directSavings, recurring, goalsById, undefined,
      new Map([['s-1', { amount: 2_000_000, countedAsDeposit: false }]]))
    expect(row.items.find(i => i.recurringId === 's-1')!.recorded).toBe(true) // via fulfillment
    expect(row.items.find(i => i.recurringId === 's-2')!.recorded).toBe(true) // via deposit
    expect(row.contributed).toBe(4_000_000) // combine fulfillment 2M + deposit 2M
  })

  it('never marks a skipped recurring recorded even if a fulfillment exists', () => {
    const recurring = resolveRecurringSavings(
      [saving({ saving_id: 's-1', goal_id: 'g-1', amount_vnd: 2_000_000 })],
      [{ recurring_saving_id: 's-1', monthly_amount_override_vnd: 0 }],
    )
    const [row] = buildByGoal([], [], recurring, goalsById, undefined,
      new Map([['s-1', { amount: 2_000_000, countedAsDeposit: false }]]))
    expect(row.items[0].skipped).toBe(true)
    expect(row.items[0].recorded).toBeFalsy()
    expect(row.contributed).toBe(0)
  })

  it('still matches by deposit when no fulfillments are passed (back-compat)', () => {
    const recurring = resolveRecurringSavings([saving({ goal_id: 'g-1', amount_vnd: 2_000_000 })], [])
    const directSavings: GoalDirectSaving[] = [
      { goal_id: 'g-1', amount_vnd: 2_000_000, savings_goals: { goal_name: 'Retirement' } },
    ]
    const [row] = buildByGoal([], directSavings, recurring, goalsById)
    expect(row.items[0].recorded).toBe(true)
  })
})
