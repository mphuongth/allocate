// Auto-detect "merge clusters": groups of a goal's maturing bank deposits whose
// maturities fall close together, so the dashboard can proactively offer to fold
// them into one re-deposit ("Gộp nhiều nguồn") instead of making the user open
// one and discover the merge UI. Pure + deterministic, built on the shared PR2
// eligibility rules (lib/mergeEligibility) so the banner's promised count is
// exactly what the resolve sheet will preselect — no over-promising.
//
// A cluster is goal-scoped: it needs ≥2 liquidatable bank deposits in the same
// goal, with at least one sibling that is eligible (in-window, same currency, not
// pledged) against the ANCHOR — the latest-maturing ACTIONABLE deposit. Opening
// the sheet on that anchor lets the rest settle early and roll into it.
//
// The anchor must be actionable (matured / within the reminder window) for two
// reasons: the maturity card only surfaces actionable deposits, and the resolve
// flow opens on one. A SIBLING need not be actionable, though — a deposit that
// matures a few days later can still settle early and fold in. So the banner
// surfaces exactly when the sheet would preselect: as soon as there is something
// to act on now plus a close-maturing partner, even if the partner isn't due yet.

import { classifyMergeSource, type MergeEligInput } from './mergeEligibility'

// A maturing deposit as the detector reads it: the eligibility fields plus the
// goal it belongs to (null/undefined = unassigned, not clusterable) and whether
// it is actionable now (anchor-eligible). `actionable` defaults to true so the
// lib is usable without the flag; the dashboard passes it explicitly.
export interface MergeClusterInput extends MergeEligInput {
  goalId?: string | null
  actionable?: boolean
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
    // Anchor = latest-maturity ACTIONABLE deposit (tie-break by id). A goal with
    // nothing actionable has nothing to act on now → no banner, even if two
    // future deposits would otherwise pair up.
    const actionables = group.filter((d) => d.actionable ?? true)
    if (actionables.length === 0) continue
    const anchor = [...actionables].sort(
      (a, b) => (b.expiryDate ?? '').localeCompare(a.expiryDate ?? '') || a.id.localeCompare(b.id),
    )[0]
    // Count siblings the sheet would actually preselect — same eligibility
    // predicate, drawn from the WHOLE group (an in-window sibling counts even if
    // it isn't due yet), so the banner can't promise a merge the sheet then blocks.
    const siblingIds = group
      .filter((s) => s.id !== anchor.id)
      .filter((s) => classifyMergeSource(anchor, s, windowDays).eligible)
      .map((s) => s.id)
    if (siblingIds.length === 0) continue
    clusters.push({ goalId, anchorId: anchor.id, siblingIds, size: siblingIds.length + 1 })
  }
  return clusters
}
