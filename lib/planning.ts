// Pure planning helpers for the Monthly Plan "By goal" section.
//
// The plan groups recurring contributions by goal: fund investments (incl. DCA),
// one-off direct savings, and recurring bank savings — the new named rules that
// auto-recur each month within an effective period, with per-month skip/override
// layered on top (mirrors fixed expenses). Server-side filters recurring savings
// to those active in the selected month; this module resolves overrides, groups
// by goal, and keeps the Unallocated group (null goal) last.

const UNALLOCATED = '__unallocated__'

// ─── Recurring savings ─────────────────────────────────────────────────────────

export interface RecurringSaving {
  saving_id: string
  name: string
  goal_id: string | null
  amount_vnd: number
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
}

// Apply per-month overrides to the active recurring savings. An override of 0
// means "skip this month"; any other positive value replaces the base amount.
export function resolveRecurringSavings(
  savings: RecurringSaving[],
  overrides: RecurringSavingOverride[],
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
  is_dca_seeded?: boolean
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
  isRecurring?: boolean
  recurringId?: string
  skipped?: boolean
  overridden?: boolean
}

export interface GoalRow {
  goalId: string
  goalName: string
  totalAllocated: number
  isUnallocated: boolean
  items: GoalItem[]
}

// Merge fund investments, one-off direct savings and resolved recurring savings
// into goal groups. `goalsById` resolves a goal id to its display name when the
// row itself doesn't carry one. The Unallocated group (null goal) is sorted last.
export function buildByGoal(
  investments: GoalInvestment[],
  directSavings: GoalDirectSaving[],
  recurring: ResolvedSaving[],
  goalsById: Map<string, string>,
  labels?: { unallocated?: string; directSaving?: string },
): GoalRow[] {
  const unallocatedLabel = labels?.unallocated ?? 'Unallocated'
  const directLabel = labels?.directSaving ?? 'Direct savings'
  const map = new Map<string, GoalRow>()

  const ensure = (goalId: string | null, name?: string | null): GoalRow => {
    const key = goalId ?? UNALLOCATED
    if (!map.has(key)) {
      const isUnallocated = goalId == null
      map.set(key, {
        goalId: key,
        goalName: isUnallocated ? unallocatedLabel : name || goalsById.get(goalId!) || 'Unassigned',
        totalAllocated: 0,
        isUnallocated,
        items: [],
      })
    }
    return map.get(key)!
  }

  for (const inv of investments) {
    const row = ensure(inv.goal_id, inv.savings_goals?.goal_name)
    row.totalAllocated += inv.amount_vnd
    row.items.push({
      name: inv.funds?.name ?? 'Unknown fund',
      type: 'fund',
      amount: inv.amount_vnd,
      isDCA: inv.is_dca_seeded,
    })
  }

  for (const sav of directSavings) {
    const row = ensure(sav.goal_id, sav.savings_goals?.goal_name)
    row.totalAllocated += sav.amount_vnd
    row.items.push({ name: directLabel, type: 'bank', amount: sav.amount_vnd })
  }

  for (const r of recurring) {
    const row = ensure(r.goalId, r.goalName)
    row.totalAllocated += r.amount
    row.items.push({
      name: r.name,
      type: 'bank',
      amount: r.amount,
      baseAmount: r.baseAmount,
      isRecurring: true,
      recurringId: r.id,
      skipped: r.skipped,
      overridden: r.overridden,
    })
  }

  return [...map.values()].sort((a, b) => {
    if (a.isUnallocated) return 1
    if (b.isUnallocated) return -1
    return a.goalName.localeCompare(b.goalName)
  })
}
