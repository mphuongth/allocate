// Effective-date range rules shared by the fixed-expense and recurring-saving
// APIs (#686).
//
// Both tables carry the same guard —
//   CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_from <= effective_to)
// — and both PUT routes used to check only the fields the request supplied. A
// partial update therefore compared the new endpoint against `null` rather than
// the endpoint already stored: `PUT { effective_from: '2026-07' }` on a row
// ending 2026-06 passed the route and was refused by the table, and the
// catch-all reported that refusal as 404 "not found" about a row that is right
// there. Deciding this from (what the body supplies + what the row stores) is
// pure, so it lives here and both routes ask the same questions.

/** The endpoints a request supplies. A key is absent when the body omits it. */
export type RangePatch = { from?: string | null; to?: string | null }

/** The endpoints already stored, or null when there is no such row. */
export type StoredRange = { effective_from: string | null; effective_to: string | null } | null

export const INVERTED_RANGE_MESSAGE = '"Active from" must be before "Active until".'

/**
 * Does judging this patch require reading the row first?
 *
 * Only when exactly one endpoint is being *set*. Supplying both determines the
 * resulting range on its own, and clearing an endpoint can never invert it —
 * NULL disables the CHECK on that side — so neither case is worth a round trip.
 */
export function needsStoredRange(patch: RangePatch): boolean {
  const setsFrom = 'from' in patch && patch.from != null
  const setsTo = 'to' in patch && patch.to != null
  if (setsFrom && setsTo) return false
  return setsFrom || setsTo
}

/**
 * Would applying this patch to that row leave `effective_from` after
 * `effective_to`? Fields the body omits fall back to the stored value, which is
 * the whole point: the merged row is what the table will see.
 *
 * A missing row is nothing to contradict — existence and ownership are the
 * update statement's job, so a foreign id keeps answering 404 rather than 400.
 */
export function mergedRangeIsInverted(patch: RangePatch, stored: StoredRange): boolean {
  const from = 'from' in patch ? patch.from ?? null : stored?.effective_from ?? null
  const to = 'to' in patch ? patch.to ?? null : stored?.effective_to ?? null
  return Boolean(from && to && from > to)
}

// `fixed_expenses` names the constraint; `recurring_savings` declares it inline
// at table level, so Postgres generates `<table>_check`.
const RANGE_CONSTRAINTS = ['effective_dates_order', 'recurring_savings_check']

/**
 * Is this write refusal the range CHECK?
 *
 * The read-then-write above can still be outrun by a concurrent update moving
 * the other endpoint, and then the table is the one that says no. That refusal
 * is a validation failure and must answer 400 — reported as 404 it reads as a
 * missing row, the error-vs-not-found conflation of #532/#533.
 */
export function isRangeCheckViolation(error: { code?: string; message?: string } | null): boolean {
  if (error?.code !== '23514') return false
  const message = error.message ?? ''
  return RANGE_CONSTRAINTS.some((name) => message.includes(`"${name}"`))
}
