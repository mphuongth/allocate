// Bank term-deposit maturity helpers.
//
// A "term deposit" is a bank investment that carries an interest rate and a
// maturity (expiry) date. Once it passes that date the user must decide what to
// do — renew (roll principal + interest, principal only, or change amount/term)
// or withdraw — so the app surfaces the ones that need a decision. These are the
// pure, framework-free pieces of that flow; the UI lives in
// app/assets/components/MaturityResolveSheet.tsx. See also `fmtMaturity` in
// goalDetailShared.tsx for the display formatting.

// Surface a deposit as "needs attention" once it is within this many days of
// maturity (in addition to already-matured ones).
export const MATURITY_REMINDER_DAYS = 1

// Window event the dashboard dispatches (detail = number) with the live count of
// maturing deposits, so the nav badge updates the instant the dashboard's data
// changes — e.g. right after a renewal — instead of waiting for its own fetch.
export const MATURING_COUNT_EVENT = 'cairn:maturing-count'

export type MaturityState = 'active' | 'maturing' | 'matured'

export type RenewMode = 'principal_interest' | 'principal_only' | 'change'

export interface MaturityDeposit {
  type: string
  interestRate: number | null
  expiryDate: string | null
}

// A bank holding counts as a term deposit only when it has both an interest
// rate and a maturity date — that is what the add-transaction form records for
// `depositType: 'term'` (a flexible deposit leaves the rate null).
export function isTermDeposit(inv: MaturityDeposit): boolean {
  return inv.type === 'bank' && inv.interestRate != null && !!inv.expiryDate
}

// Classify a deposit from the number of days until its maturity (negative =
// already passed). `diffDays` comes from `fmtMaturity(...).diffDays`.
export function depositMaturityState(diffDays: number): MaturityState {
  if (diffDays < 0) return 'matured'
  if (diffDays <= MATURITY_REMINDER_DAYS) return 'maturing'
  return 'active'
}

export function isMaturityActionable(state: MaturityState): boolean {
  return state === 'matured' || state === 'maturing'
}

// Whole days from today until the given YYYY-MM-DD date (negative once past).
// Mirrors the diffDays computation in fmtMaturity so the two never diverge.
export function daysUntil(isoDate: string): number {
  const d = new Date(isoDate + 'T00:00:00')
  if (isNaN(d.getTime())) return NaN
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / 86_400_000)
}

// Whether a non-fund holding is a term deposit that needs a decision right now
// (matured, or within the reminder window). Generic over the minimal shape so
// both dashboard overview items and InvRows qualify — the single source of
// truth for the "needs attention" card and the nav badge count.
export function isActionableTermDeposit(
  it: { type: string; interestRate: number | null; expiryDate: string | null },
): boolean {
  if (!isTermDeposit(it)) return false
  return isMaturityActionable(depositMaturityState(daysUntil(it.expiryDate!)))
}

const pad = (n: number) => String(n).padStart(2, '0')

// Add `n` whole months to a YYYY-MM-DD date, keeping the day of month but
// clamping to the last valid day when the target month is shorter (so
// 31 Jan + 1 month → 28 Feb rather than rolling into March). Computed in UTC
// from the date parts to stay timezone-independent.
export function addMonths(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + n, 1))
  const year = target.getUTCFullYear()
  const month = target.getUTCMonth()
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return `${year}-${pad(month + 1)}-${pad(Math.min(d, lastDay))}`
}

// Whole months between two YYYY-MM-DD dates (the count of complete months from
// `fromIso` to `toIso`). Used to derive a deposit's original term length from
// its open date and maturity date when suggesting the renewal term.
export function monthsBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number)
  const [ty, tm, td] = toIso.split('-').map(Number)
  let months = (ty - fy) * 12 + (tm - fm)
  if (td < fd) months -= 1 // the final month hasn't fully elapsed
  return months
}

// The principal that the next cycle starts with, per the chosen renewal mode.
export function renewalPrincipal(
  mode: RenewMode,
  principal: number,
  interest: number,
  newAmount: number | null,
): number {
  if (mode === 'principal_interest') return principal + interest
  if (mode === 'change') return newAmount ?? principal
  return principal // principal_only
}
