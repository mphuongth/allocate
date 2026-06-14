// Plain-date ("YYYY-MM-DD") helpers that treat a date as a LOCAL calendar day,
// matching how daysUntil/fmtMaturity parse maturity dates (`new Date(d + 'T00:00:00')`).
//
// Why this exists: `new Date().toISOString().slice(0, 10)` yields the UTC date,
// which in a timezone ahead of UTC (e.g. Vietnam, UTC+7) is yesterday during the
// first hours of the local day. Mixing that with the local-parsing maturity code
// drifted "today" — and a recorded investment_date — by up to a day. Use these so
// every plain-date "today"/comparison agrees on the user's local calendar.

const pad = (n: number) => String(n).padStart(2, '0')

// Today in the local timezone as YYYY-MM-DD (not the UTC date).
export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Whether a plain investment date is clearly in the future. The server runs in
// UTC but clients send their LOCAL "today", so a client ahead of UTC can send
// the server's "tomorrow" for a perfectly valid same-day entry. Allow one day of
// skew and reject only dates beyond it. Compared as plain dates (ISO strings sort
// chronologically), so any time portion on the input is ignored.
export function isFutureInvestmentDate(isoDate: string, asOf: Date = new Date()): boolean {
  const max = new Date(asOf)
  max.setUTCDate(max.getUTCDate() + 1)
  return isoDate.slice(0, 10) > max.toISOString().slice(0, 10)
}
