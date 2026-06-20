// "Ví chờ gộp" (merge holding pool) synthesis — PR4 of "Gộp nhiều nguồn".
//
// A held settlement is a withdrawal row (held_for_merge=true) that closed an
// earlier-maturing deposit while parking its cash for a future merge. Closing the
// deposit removed its principal from both net worth and the goal bar; this helper
// turns each still-in-the-pool holding back into a per-goal contribution so the
// caller can add it where the deposit used to count — net effect zero, the cash
// keeps counting, and it never reappears as a deposit row.
//
// Pure + deterministic, mirroring realizedRecurringContributions (lib/finance):
// one synthesized contribution per holding, the caller sums them into the goal.
// A holding leaves the pool the moment a merge stamps consumed_by_inv_id — its
// cash then lives in the renewed deposit's principal, so we must stop adding it.

export interface HeldWithdrawalRow {
  amount_vnd: number
  // The goal the held cash stays earmarked to. NULL = nothing to add it back to.
  merge_target_goal_id: string | null
  held_for_merge?: boolean | null
  // Set once a merge folds the holding into the renewed deposit. NULL = still pooled.
  consumed_by_inv_id?: string | null
}

export interface HeldContribution {
  goalId: string
  amount: number
}

export function heldForMergeContributions(rows: HeldWithdrawalRow[]): HeldContribution[] {
  const out: HeldContribution[] = []
  for (const r of rows) {
    if (r.held_for_merge !== true) continue // not held (legacy/plain withdrawal)
    if (r.consumed_by_inv_id != null) continue // already folded into a re-deposit
    if (!r.merge_target_goal_id) continue // no goal to credit
    if (!(r.amount_vnd > 0)) continue
    out.push({ goalId: r.merge_target_goal_id, amount: r.amount_vnd })
  }
  return out
}
