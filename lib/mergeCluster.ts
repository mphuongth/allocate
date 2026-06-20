// Auto-detect "merge clusters": groups of a goal's maturing bank deposits whose
// maturities fall close together, so the dashboard can proactively offer to fold
// them into one re-deposit ("Gộp nhiều nguồn") instead of making the user open
// one and discover the merge UI. Pure + deterministic, built on the shared PR2
// eligibility rules (lib/mergeEligibility) so the banner's promised count is
// exactly what the resolve sheet will preselect — no over-promising.
//
// A cluster is goal-scoped: it needs ≥2 liquidatable bank deposits in the same
// goal, with at least one sibling that is eligible (in-window, same currency, not
// pledged) against the ANCHOR — the latest-maturing deposit. Opening the sheet on
// that anchor lets the rest settle early and roll into it; anchoring on the
// latest maturity means every sibling settles at or before its own term, never
// after (the anchor's renewal carries the new, later maturity).

import { classifyMergeSource, type MergeEligInput } from './mergeEligibility'

// A maturing deposit as the detector reads it: the eligibility fields plus the
// goal it belongs to (null/undefined = unassigned, not clusterable).
export interface MergeClusterInput extends MergeEligInput {
  goalId?: string | null
}

export interface MergeCluster {
  goalId: string
  // The latest-maturing deposit — the merge sheet opens on this one.
  anchorId: string
  // Eligible in-window siblings to preselect (excludes the anchor).
  siblingIds: string[]
  // anchor + siblings.
  size: number
}

// A deposit that can take part in a merge — as anchor OR sibling. Pledged is an
// *absolute* block (frozen as collateral), so excluded from the pool up front; a
// pledged deposit can be neither the merge target nor a source. Currency stays
// out of this gate because it's anchor-relative (handled per-sibling below).
function liquidatable(d: MergeClusterInput): boolean {
  return (
    d.type === 'bank' &&
    !d.depositGroupId &&
    !d.isPledged &&
    (d.principal ?? d.value ?? 0) > 0
  )
}

export function detectMergeClusters(
  deposits: MergeClusterInput[],
  windowDays = 7,
): MergeCluster[] {
  // Bucket liquidatable bank deposits by goal (skip the unassigned — a merge
  // folds siblings into the goal's re-deposit, so there's no cluster without one).
  const byGoal = new Map<string, MergeClusterInput[]>()
  for (const d of deposits) {
    if (d.goalId == null || !liquidatable(d)) continue
    const arr = byGoal.get(d.goalId) ?? []
    arr.push(d)
    byGoal.set(d.goalId, arr)
  }

  const clusters: MergeCluster[] = []
  for (const [goalId, group] of byGoal) {
    if (group.length < 2) continue
    // Anchor = latest maturity (tie-break by id for a deterministic pick).
    const anchor = [...group].sort(
      (a, b) => (b.expiryDate ?? '').localeCompare(a.expiryDate ?? '') || a.id.localeCompare(b.id),
    )[0]
    // Only count siblings the sheet would actually preselect — same eligibility
    // predicate, so the banner can't promise a merge the sheet then blocks.
    const siblingIds = group
      .filter((s) => s.id !== anchor.id)
      .filter((s) => classifyMergeSource(anchor, s, windowDays).eligible)
      .map((s) => s.id)
    if (siblingIds.length === 0) continue
    clusters.push({ goalId, anchorId: anchor.id, siblingIds, size: siblingIds.length + 1 })
  }
  return clusters
}
