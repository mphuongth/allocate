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
//   2. NAME     — exactly one candidate whose name normalizes-equals / contains
//                 (either direction) the deposit's name.
//   3. SOLE     — exactly one candidate, with no conflicting name signal.
//   • Otherwise AMBIGUOUS — match is null; candidates is the shortlist to choose
//     from (the name matches when there is more than one, else all candidates).

export interface RecurringLinkCandidate {
  saving_id: string
  name: string
  amount_vnd: number
  fulfilled?: boolean
  linkedDepositKey?: string | null
}

export type RecurringLinkReason = 'explicit' | 'name' | 'sole' | 'ambiguous'

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

  // 2. Name match within the goal (two-way, whitespace/case-insensitive).
  const b = norm(depositName)
  const nameMatches = b
    ? pool.filter((c) => {
        const a = norm(c.name)
        return a === b || a.includes(b) || b.includes(a)
      })
    : []
  if (nameMatches.length === 1) return { match: nameMatches[0], candidates: pool, ambiguous: false, reason: 'name' }

  // 3. Sole candidate, with no conflicting name signal.
  if (pool.length === 1 && nameMatches.length !== 1) {
    return { match: pool[0], candidates: pool, ambiguous: false, reason: 'sole' }
  }

  // Ambiguous — let the user choose. Prefer the name matches as the shortlist.
  const shortlist = nameMatches.length > 1 ? nameMatches : pool
  return { match: null, candidates: shortlist, ambiguous: true, reason: 'ambiguous' }
}
