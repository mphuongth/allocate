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
