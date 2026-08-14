// Pure planning helpers for the Monthly Plan "By goal" section.
//
// The plan groups recurring contributions by goal: fund investments (incl. DCA),
// one-off direct savings, and recurring bank savings — the new named rules that
// auto-recur each month within an effective period, with per-month skip/override
// layered on top (mirrors fixed expenses). Server-side filters recurring savings
// to those active in the selected month; this module resolves overrides, groups
// by goal, and keeps the Unallocated group (null goal) last.

import { businessYearMonth } from './dates'

const UNALLOCATED = '__unallocated__'

// A recurring recorded this month via a fulfillment row, and whether that path
// ALSO logged a plan-scoped bank deposit. Book top-up writes a tranche with a
// plan_id (so it's already in directSavings → contributed counts it); maturity-
// combine's re-deposit isn't plan-scoped, so its fulfillment is the only record.
export interface MonthFulfillment {
  amount: number
  countedAsDeposit: boolean
}

// Fulfillment `source` values whose path also logs a plan-scoped deposit — used
// to set MonthFulfillment.countedAsDeposit so contributed isn't double-counted.
export const DEPOSIT_BACKED_FULFILLMENT_SOURCES = new Set(['recurring-topup'])

// ─── Recurring savings ─────────────────────────────────────────────────────────

export interface RecurringSaving {
  saving_id: string
  name: string
  goal_id: string | null
  amount_vnd: number
  linked_deposit_tx_id?: string | null
  // Stamped when the linked deposit was deleted out from under this saving
  // (#655). Not the same as "unlinked": most savings never had a link.
  unlinked_at?: string | null
  // Whether that deposit was an accumulating book's anchor. A book really was
  // taking the monthly contribution; a plain term deposit never was, so the two
  // losses cannot be described by the same sentence.
  unlinked_from_book?: boolean | null
  // Why the link went: 'deleted' (#655) or 'closed' (#650). A deposit that was
  // fully withdrawn is still on the ledger, so the plan must not call it deleted.
  // Absent on rows stamped before the column existed — all of which were
  // deletions, the only thing that wrote a stamp then.
  unlinked_reason?: string | null
  savings_goals?: { goal_name: string } | null
}

export interface RecurringSavingOverride {
  recurring_saving_id: string
  monthly_amount_override_vnd: number
}

export interface ResolvedSaving {
  id: string
  name: string
  goalId: string | null
  goalName: string | null
  baseAmount: number
  amount: number // effective amount this month (0 when skipped)
  skipped: boolean
  overridden: boolean
  linkedDepositTxId: string | null // an explicitly linked deposit/book, if any
  // The deposit this saving fed was deleted and nothing replaced it (#655), so
  // the monthly contribution no longer reaches the book the user aimed it at.
  // Both halves matter: a stamp on a saving that is linked again is answered.
  linkLost: boolean
  // …and it was a book taking the contribution, not a term deposit the link
  // merely identified. Decides which consequence the warning may claim.
  linkLostFromBook: boolean | undefined
  linkLostReason: 'deleted' | 'closed'
}

// Was the link already gone by the month being viewed? The plan pages back
// through past months, and a deposit deleted in August was still linked all
// through July — showing July the badge describes a state that month never had.
// The stamp is an instant, so the month it belongs to is the BUSINESS month:
// 18:00 UTC on 31 July is already August in Ho Chi Minh City.
function lostByMonth(unlinkedAt: string | null | undefined, ym?: string): boolean {
  if (unlinkedAt == null) return false
  if (!ym) return true
  const { year, month } = businessYearMonth(new Date(unlinkedAt))
  return `${year}-${String(month).padStart(2, '0')}` <= ym
}

// Apply per-month overrides to the active recurring savings. An override of 0
// means "skip this month"; any other positive value replaces the base amount.
// `ym` ("YYYY-MM") is the month being viewed — omit it and a lost link is
// reported regardless of when it was lost.
export function resolveRecurringSavings(
  savings: RecurringSaving[],
  overrides: RecurringSavingOverride[],
  ym?: string,
): ResolvedSaving[] {
  const ovMap = new Map(overrides.map(o => [o.recurring_saving_id, o.monthly_amount_override_vnd]))
  return savings.map(s => {
    const ov = ovMap.get(s.saving_id)
    const hasOv = ov !== undefined
    const skipped = ov === 0
    return {
      id: s.saving_id,
      name: s.name,
      goalId: s.goal_id,
      goalName: s.savings_goals?.goal_name ?? null,
      baseAmount: s.amount_vnd,
      amount: skipped ? 0 : hasOv ? ov! : s.amount_vnd,
      skipped,
      overridden: hasOv && ov! > 0 && ov !== s.amount_vnd,
      linkedDepositTxId: s.linked_deposit_tx_id ?? null,
      linkLost: s.linked_deposit_tx_id == null && lostByMonth(s.unlinked_at, ym),
      // undefined, not false: the repair of a legacy closed book cannot recover
      // whether the target was a book (the group was cleared before it ran), and
      // "not a book" is a claim, not an absence of one.
      linkLostFromBook: s.unlinked_from_book ?? undefined,
      linkLostReason: s.unlinked_reason === 'closed' ? 'closed' : 'deleted',
    }
  })
}

export function recurringSavingsTotal(resolved: ResolvedSaving[]): number {
  return resolved.reduce((s, r) => s + r.amount, 0)
}

// ─── By-goal grouping ───────────────────────────────────────────────────────────

export interface GoalInvestment {
  goal_id: string | null
  amount_vnd: number
  units?: number | null // a recorded buy when non-null; pending DCA row when null
  is_dca_seeded?: boolean
  skipped?: boolean // synthesized: a DCA fund skipped this month
  fund_id?: string | null
  transaction_id?: string
  funds?: { name: string } | null
  savings_goals?: { goal_name: string } | null
}

export interface GoalDirectSaving {
  goal_id: string | null
  amount_vnd: number
  savings_goals?: { goal_name: string } | null
}

export interface GoalItem {
  name: string
  type: 'fund' | 'bank'
  amount: number
  baseAmount?: number
  isDCA?: boolean
  isFundDca?: boolean // a fund DCA plan line (gets Buy / skip actions)
  fundId?: string | null
  transactionId?: string
  recorded?: boolean // the DCA buy has been logged (units set)
  isRecurring?: boolean
  recurringId?: string
  skipped?: boolean
  overridden?: boolean
  // An accumulating book this recurring is linked to (its anchor id), if any —
  // the "Saved" pill tops up that book instead of logging a standalone deposit.
  linkedDepositTxId?: string | null
  // That book was deleted and this saving now feeds nothing in particular (#655).
  linkLost?: boolean
  // …and it was a book, so the contribution really has stopped going somewhere.
  // Undefined when that cannot be known (see resolveRecurringSavings).
  linkLostFromBook?: boolean
  // Deleted out from under the saving (#655), or closed by a full withdrawal
  // (#650). Two different things to be told.
  linkLostReason?: 'deleted' | 'closed'
}

export interface GoalRow {
  goalId: string
  goalName: string
  totalAllocated: number // planned this month (DCA + recurring savings)
  contributed: number // actually logged this month (recorded buys + bank deposits)
  isUnallocated: boolean
  items: GoalItem[]
}

// Merge fund DCA plans, recorded contributions and recurring savings into goal
// groups. PLANNED (totalAllocated) = fund DCA + recurring savings line items.
// CONTRIBUTED = money actually logged this month: recorded fund buys (units set)
// and bank deposits. `goalsById` resolves a goal id to its display name when the
// row doesn't carry one. The Unallocated group (null goal) is sorted last.
export function buildByGoal(
  investments: GoalInvestment[],
  directSavings: GoalDirectSaving[],
  recurring: ResolvedSaving[],
  goalsById: Map<string, string>,
  labels?: { unallocated?: string },
  // Recurring-saving ids → this month's fulfillment. These were recorded via a
  // path the goal+amount deposit match can't see (maturity-combine, book top-up),
  // so we mark the line recorded. We add the amount to contributed ONLY when the
  // path didn't also log a plan-scoped deposit (countedAsDeposit=false) — else
  // the deposit already counts it in the directSavings loop and we'd double-count.
  fulfillments?: Map<string, MonthFulfillment>,
): GoalRow[] {
  const unallocatedLabel = labels?.unallocated ?? 'Unallocated'
  const map = new Map<string, GoalRow>()

  const ensure = (goalId: string | null, name?: string | null): GoalRow => {
    const key = goalId ?? UNALLOCATED
    if (!map.has(key)) {
      const isUnallocated = goalId == null
      map.set(key, {
        goalId: key,
        goalName: isUnallocated ? unallocatedLabel : name || goalsById.get(goalId!) || 'Unassigned',
        totalAllocated: 0,
        contributed: 0,
        isUnallocated,
        items: [],
      })
    }
    return map.get(key)!
  }

  for (const inv of investments) {
    const row = ensure(inv.goal_id, inv.savings_goals?.goal_name)
    const recorded = inv.units != null

    if (inv.skipped) {
      // A DCA fund skipped this month — show it struck through, 0 planned.
      row.items.push({
        name: inv.funds?.name ?? 'Unknown fund',
        type: 'fund', amount: 0, baseAmount: inv.amount_vnd,
        isDCA: true, isFundDca: true, fundId: inv.fund_id, skipped: true,
      })
      continue
    }

    if (inv.is_dca_seeded) {
      // A planned DCA line. Counts toward planned; toward contributed once logged.
      row.totalAllocated += inv.amount_vnd
      row.items.push({
        name: inv.funds?.name ?? 'Unknown fund',
        type: 'fund', amount: inv.amount_vnd,
        isDCA: true, isFundDca: true, fundId: inv.fund_id,
        transactionId: inv.transaction_id, recorded,
      })
    }
    // Any recorded buy (DCA or ad-hoc) is money that actually went in.
    if (recorded) row.contributed += inv.amount_vnd
  }

  // Logged bank deposits, pooled per goal by amount. They count as contributed
  // and also let us mark the matching recurring-saving line as recorded this
  // month (the deposit isn't linked to a specific saving, so we match greedily
  // on goal + amount — one deposit completes one planned line).
  const depositPool = new Map<string, number[]>()
  for (const sav of directSavings) {
    const row = ensure(sav.goal_id, sav.savings_goals?.goal_name)
    row.contributed += sav.amount_vnd
    const key = sav.goal_id ?? UNALLOCATED
    const pool = depositPool.get(key)
    if (pool) pool.push(sav.amount_vnd)
    else depositPool.set(key, [sav.amount_vnd])
  }

  for (const r of recurring) {
    const row = ensure(r.goalId, r.goalName)
    row.totalAllocated += r.amount
    // A non-skipped recurring line is "recorded" if it has a fulfillment row for
    // the month (maturity-combine / book top-up), or — failing that — once a
    // deposit of the same amount toward the same goal has been logged. We check
    // the fulfillment first and don't touch the pool when it hits, so a fulfilled
    // line never eats a deposit that a sibling line should match. A combine
    // fulfillment also counts toward contributed (its re-deposit isn't plan-scoped,
    // so this is the only place its money lands → drives the progress bar); a
    // top-up fulfillment does NOT, since its tranche already counts in directSavings.
    let recorded = false
    if (!r.skipped) {
      const fulfilled = fulfillments?.get(r.id)
      if (fulfilled) {
        recorded = true
        if (!fulfilled.countedAsDeposit) row.contributed += fulfilled.amount
      } else {
        const pool = depositPool.get(r.goalId ?? UNALLOCATED)
        const i = pool ? pool.indexOf(r.amount) : -1
        if (pool && i !== -1) { pool.splice(i, 1); recorded = true }
      }
    }
    row.items.push({
      name: r.name,
      type: 'bank',
      amount: r.amount,
      baseAmount: r.baseAmount,
      isRecurring: true,
      recurringId: r.id,
      skipped: r.skipped,
      overridden: r.overridden,
      recorded,
      linkedDepositTxId: r.linkedDepositTxId,
      linkLost: r.linkLost,
      linkLostFromBook: r.linkLostFromBook,
      linkLostReason: r.linkLostReason,
    })
  }

  return [...map.values()].sort((a, b) => {
    if (a.isUnallocated) return 1
    if (b.isUnallocated) return -1
    return a.goalName.localeCompare(b.goalName)
  })
}
