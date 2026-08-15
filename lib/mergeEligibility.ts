// Eligibility ruleset for folding a sibling source into a maturity re-deposit
// ("Gộp nhiều nguồn"). Pure + deterministic so the merge sheet (preselect the
// eligible, dim the blocked) and the PR3 cluster auto-detector can share one
// source of truth, and so the rules are unit-testable in isolation.
//
// The five conditions (see the design's "Bộ luật" card):
//   1. Same goal          — every source points at one goal (the cluster key).
//   2. Liquidatable       — an active single bank term deposit (not a fund/gold,
//                           not an accumulating book, not fully withdrawn).
//   3. Maturities close    — |source.maturity − anchor.maturity| ≤ window days.
//   4. Same currency      — no mixing VND with a foreign currency.
//   5. Not pledged        — neither side frozen as collateral. A pledged SOURCE
//                           cannot be liquidated into the merge; a pledged
//                           ANCHOR cannot receive the cash, because it would
//                           land inside a balance the user cannot withdraw
//                           until the pledge is released (#635). Release the
//                           pledge first, in either direction.
//
// Rule 1 (same goal) is normally the *caller's* job: the merge sheet only ever
// passes a goal's own holdings, so it's enforced by scoping. We still check it
// here when both goal ids are known, so the cluster detector can lean on the
// same predicate. Only rule 3 is a *soft* block — the user can override it
// ("Gộp sớm?", accepting an early-settlement penalty); the rest are hard.

export type MergeBlockReason =
  | 'not-liquidatable'
  | 'different-goal'
  | 'different-currency'
  | 'pledged'
  | 'pledged-anchor'
  | 'out-of-window'

// The minimal shape the rules read. InvRow (goal-detail) is structurally
// assignable to it; the overview NonFundEntry carries the same fields.
export interface MergeEligInput {
  id: string
  type: string
  // Maturity (YYYY-MM-DD); null for a holding with no term.
  expiryDate: string | null
  principal?: number | null
  value?: number | null
  // Set for an accumulating book — excluded from the single-deposit merge.
  depositGroupId?: string | null
  // null/undefined → treated as VND (legacy deposits predate the column).
  currency?: string | null
  isPledged?: boolean | null
  // Optional — the goal check runs only when both sides supply one.
  goalId?: string | null
}

export interface MergeClassification {
  source: MergeEligInput
  eligible: boolean
  // The first failing rule (hard blocks before the soft window block), or null
  // when eligible.
  reason: MergeBlockReason | null
  // Only the window block is overridable ("Gộp sớm?"). Hard blocks are false.
  overridable: boolean
  // |source.maturity − anchor.maturity| in whole days; null when either maturity
  // is missing (so closeness can't be measured — treated as out-of-window).
  maturityGapDays: number | null
}

const DEFAULT_CURRENCY = 'VND'

// Whole-day difference between two YYYY-MM-DD dates, via UTC midnight so DST and
// local-offset shifts can't round it off by a day.
function dayDiff(a: string, b: string): number {
  const ms = Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')
  return Math.round(ms / 86_400_000)
}

function currencyOf(s: MergeEligInput): string {
  return s.currency ?? DEFAULT_CURRENCY
}

export function classifyMergeSource(
  anchor: MergeEligInput,
  source: MergeEligInput,
  windowDays = 7,
): MergeClassification {
  // An active single bank term deposit with a positive balance.
  const liquidatable =
    source.type === 'bank' &&
    !source.depositGroupId &&
    (source.principal ?? source.value ?? 0) > 0

  const gap =
    anchor.expiryDate && source.expiryDate
      ? Math.abs(dayDiff(source.expiryDate, anchor.expiryDate))
      : null

  let reason: MergeBlockReason | null = null
  let overridable = false
  // The anchor first: a pledged destination blocks every source identically, so
  // reporting anything about the source would name the wrong deposit. This is
  // the only rule about the anchor's own state — the rest measure the source
  // against it (#635).
  if (anchor.isPledged) {
    reason = 'pledged-anchor'
  } else if (!liquidatable) {
    reason = 'not-liquidatable'
  } else if (anchor.goalId != null && source.goalId != null && source.goalId !== anchor.goalId) {
    reason = 'different-goal'
  } else if (currencyOf(source) !== currencyOf(anchor)) {
    reason = 'different-currency'
  } else if (source.isPledged) {
    reason = 'pledged'
  } else if (gap == null || gap > windowDays) {
    reason = 'out-of-window'
    overridable = true
  }

  return { source, eligible: reason === null, reason, overridable, maturityGapDays: gap }
}

export function classifyMergeSources(
  anchor: MergeEligInput,
  siblings: MergeEligInput[],
  windowDays = 7,
): MergeClassification[] {
  return siblings.map((s) => classifyMergeSource(anchor, s, windowDays))
}
