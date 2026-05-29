export function calcProjectedInterest(
  amount: number,
  rate: number | null,
  investmentDate: string,
  expiryDate?: string | null
): number {
  if (!rate || amount <= 0) return 0
  const endMs = expiryDate
    ? Math.min(Date.now(), new Date(expiryDate).getTime())
    : Date.now()
  const days = Math.max(0, (endMs - new Date(investmentDate).getTime()) / (1000 * 60 * 60 * 24))
  return amount * Math.pow(1 + rate / 100, days / 365) - amount
}

export function isNavStale(updatedAt: string): boolean {
  const diffMs = Date.now() - new Date(updatedAt).getTime()
  return diffMs / (1000 * 60 * 60 * 24) > 1
}

// Parse a YYYY-MM-DD (or timestamptz) string as a LOCAL midnight date so a plain
// date never slips across a timezone boundary. Only the date portion is used.
function parseLocalDate(value: string): Date | null {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  const dt = new Date(y, m - 1, d)
  return isNaN(dt.getTime()) ? null : dt
}

// Premiums renew on the anniversary of `paymentDate` (its month/day). The status
// reflects the *next* due date, so a policy whose start date is in the past does
// not read as overdue — it only becomes overdue once a renewal anniversary has
// come due and was never settled.
export function insuranceStatus(
  paymentDate: string | null,
  lastPaymentDate: string | null = null
): 'on_track' | 'upcoming' | 'overdue' | 'completed' {
  if (!paymentDate) return 'on_track'
  const anchor = parseLocalDate(paymentDate)
  if (!anchor) return 'on_track'

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const last = lastPaymentDate ? parseLocalDate(lastPaymentDate) : null

  // Work out the next due date.
  let nextDue: Date
  if (last) {
    // Paid through `last` — the next premium is the first anniversary after it.
    nextDue = new Date(last.getFullYear(), anchor.getMonth(), anchor.getDate())
    if (nextDue <= last) nextDue.setFullYear(nextDue.getFullYear() + 1)
  } else if (anchor >= today) {
    // A future date with no payment history is the upcoming due date itself.
    nextDue = anchor
  } else {
    // A past date with no history is the start: the premium is covered through
    // signup and the first renewal falls one anniversary later. (That renewal
    // may itself be in the past — then it's a genuinely missed payment.)
    nextDue = new Date(anchor)
    nextDue.setFullYear(anchor.getFullYear() + 1)
  }

  // Overdue only once the next due date has actually passed without being settled.
  if (nextDue < today) return 'overdue'

  const thirtyDaysLater = new Date(today)
  thirtyDaysLater.setDate(today.getDate() + 30)
  if (nextDue <= thirtyDaysLater) return 'upcoming'
  return 'on_track'
}

// Returns the calendar year a member's premium was last settled for, but only
// when that payment happened in the current year — i.e. the current cycle is
// paid. Returns null otherwise. The date is parsed as local so a plain
// YYYY-MM-DD string never shifts across a timezone boundary.
export function insurancePaidYear(lastPaymentDate: string | null): number | null {
  if (!lastPaymentDate) return null
  // last_payment_date is a timestamptz, so trim any time part to the date first.
  const [y, m, d] = lastPaymentDate.slice(0, 10).split('-').map(Number)
  const paid = new Date(y, (m ?? 1) - 1, d ?? 1)
  if (isNaN(paid.getTime())) return null
  return paid.getFullYear() === new Date().getFullYear() ? paid.getFullYear() : null
}

// A monthly plan exists only once income is set for that month, and its
// insurance allocation counts as saved once the month has arrived — the current
// month or any past month. A future month's allocation is not saved yet.
export function isPlanMonthRealized(year: number, month: number): boolean {
  const now = new Date()
  const nowYear = now.getFullYear()
  const nowMonth = now.getMonth() + 1
  return year < nowYear || (year === nowYear && month <= nowMonth)
}

// A contribution counts toward the CURRENT premium cycle when it was made on or
// after the last settlement. Once a premium is marked paid, earlier savings
// funded that (now-settled) cycle; contributions from the settlement day onward
// accrue toward the next one — so paying and then logging toward next year on the
// same day still counts. With no recorded payment yet, every contribution counts.
// Dates are compared as YYYY-MM-DD strings (lexicographic order = chronological).
export function isInCurrentCycle(contribDateISO: string, lastPaymentDate: string | null): boolean {
  if (!lastPaymentDate) return true
  return contribDateISO.slice(0, 10) >= lastPaymentDate.slice(0, 10)
}
