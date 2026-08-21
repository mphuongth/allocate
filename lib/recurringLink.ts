// Match a maturing term deposit to the recurring bank saving that should be
// folded into its "settle & re-deposit" (Tất toán & gửi lại) combine flow.
//
// The caller passes the candidates already scoped to the deposit's goal and
// active in the deposit's maturity month (that scoping needs plan/effective
// logic that lives elsewhere). This function drops any already-fulfilled
// candidate, then applies the matching law below. It deliberately never guesses
// when the choice is ambiguous — it hands the candidate list back so the UI can
// ask the user which saving to fold in (or none), rather than silently folding
// in the wrong one when a goal funds several recurring savings.
//
// Matching law (in priority order):
//   1. EXPLICIT — a candidate whose linkedDepositKey === the deposit's key.
//   2. NAME     — exactly one candidate whose name NORMALIZES-EQUALS the deposit's
//                 name. Only an exact (whitespace/case-insensitive) match is
//                 strong enough to auto-fold: a loose substring match would let a
//                 short deposit name silently grab an unrelated longer recurring
//                 (e.g. "So" → "Social Fund"). Substring is used only to order the
//                 ambiguous shortlist below — it never auto-selects.
//   3. SOLE     — exactly one candidate, with no exact-name tie.
//   • Otherwise AMBIGUOUS — match is null; candidates is the shortlist to choose
//     from (exact ties, else substring matches, else all candidates).

export interface RecurringLinkCandidate {
  saving_id: string
  name: string
  amount_vnd: number
  fulfilled?: boolean
  linkedDepositKey?: string | null
}

type RecurringLinkReason = 'explicit' | 'name' | 'sole' | 'ambiguous'

export interface RecurringLinkResult {
  match: RecurringLinkCandidate | null
  candidates: RecurringLinkCandidate[]
  ambiguous: boolean
  reason: RecurringLinkReason
}

const norm = (s: string | null | undefined) => (s || '').toLowerCase().replace(/\s+/g, '')

export function linkedSavingFor(
  depositName: string,
  candidates: RecurringLinkCandidate[],
  depositKey?: string | null,
): RecurringLinkResult | null {
  // Only unfulfilled candidates can still be folded in this month.
  const pool = candidates.filter((c) => !c.fulfilled)
  if (pool.length === 0) return null

  // 1. Explicit link wins outright.
  if (depositKey) {
    const linked = pool.find((c) => c.linkedDepositKey === depositKey)
    if (linked) return { match: linked, candidates: pool, ambiguous: false, reason: 'explicit' }
  }

  // 2. Exact normalized name match — the only name signal strong enough to
  //    auto-fold (a loose substring match must not silently pick the wrong one).
  const b = norm(depositName)
  const exactMatches = b ? pool.filter((c) => norm(c.name) === b) : []
  if (exactMatches.length === 1) return { match: exactMatches[0], candidates: pool, ambiguous: false, reason: 'name' }

  // 3. Sole candidate, with no exact-name tie.
  if (pool.length === 1 && exactMatches.length === 0) {
    return { match: pool[0], candidates: pool, ambiguous: false, reason: 'sole' }
  }

  // Ambiguous — let the user choose; never auto-fold. Shortlist order of
  // preference: exact ties → substring matches (min length, so a tiny fragment
  // like "So" doesn't drag in unrelated savings) → the whole pool.
  const MIN_SUBSTRING = 4
  const looseMatches = b.length >= MIN_SUBSTRING
    ? pool.filter((c) => {
        const a = norm(c.name)
        return a !== b && a.length >= MIN_SUBSTRING && (a.includes(b) || b.includes(a))
      })
    : []
  const shortlist = exactMatches.length > 1 ? exactMatches : looseMatches.length > 0 ? looseMatches : pool
  return { match: null, candidates: shortlist, ambiguous: true, reason: 'ambiguous' }
}
