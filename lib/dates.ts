// Business-date policy and plain-date ("YYYY-MM-DD") helpers.
//
// POLICY: this app has exactly one business timezone — Asia/Ho_Chi_Minh (UTC+7).
// Every "today", "current month" and plain-date comparison is derived in that
// zone, no matter where the code runs: a browser in any timezone, a Vercel
// function in UTC, or a cron job. Nothing derives a business date from UTC
// (`new Date().toISOString().slice(0, 10)`) or from the runtime's local zone
// (`new Date().getMonth()`) — both drift.
//
// Why it matters: between 00:00 and 06:59 Vietnam time the UTC calendar date is
// still *yesterday*. A UTC-derived "today" recorded transactions on the previous
// date, assigned contributions to the previous month, and keyed the dashboard's
// daily snapshot to the wrong day. Runtime-local derivation has the mirror
// problem — it makes the answer depend on where the code happens to run (#591).
//
// Plain dates are treated as whole calendar days: compared and differenced from
// their parts, never parsed into an instant, so no timezone can shift them.

export const BUSINESS_TIMEZONE = 'Asia/Ho_Chi_Minh'

const businessParts = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

// Today as YYYY-MM-DD in the business timezone. Pass `now` to pin the instant.
export function todayIso(now: Date = new Date()): string {
  const parts = businessParts.formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

// The business year and 1-based month — for the monthly-plan / recurring-savings
// logic that reasons in months rather than dates.
export function businessYearMonth(now: Date = new Date()): { year: number; month: number } {
  const [year, month] = todayIso(now).split('-').map(Number)
  return { year, month }
}

const pad = (n: number) => String(n).padStart(2, '0')

// Add `n` whole months to a YYYY-MM-DD date (negative to go back), keeping the
// day of month but clamping to the last valid day when the target month is
// shorter — so 31 Jan + 1 month → 28 Feb rather than rolling into March.
// Computed in UTC from the date parts, so it's timezone-independent.
export function addMonths(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + n, 1))
  const year = target.getUTCFullYear()
  const month = target.getUTCMonth()
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return `${year}-${pad(month + 1)}-${pad(Math.min(d, lastDay))}`
}

// A date formatted for *display* in the business timezone — the "generated on" /
// "as of" line on a report. Without the explicit zone this reads the renderer's
// clock: the PDF built on the UTC server would print yesterday while its own
// filename said today, and a user abroad would see their browser's day.
export function formatBusinessDate(
  locale: string,
  options: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' },
  now: Date = new Date(),
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: BUSINESS_TIMEZONE }).format(now)
}

// Whole months from the business month until a `YYYY-MM` target, floored at 1 —
// the horizon a goal's monthly contribution is spread over. Floored because a
// target in the current or a past month still needs one month to save into.
export function monthsUntilYm(ym: string, now: Date = new Date()): number {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return 1
  const { year, month } = businessYearMonth(now)
  return Math.max(1, (y - year) * 12 + (m - month))
}

// The business day as a Date at *local* midnight, for the date arithmetic that
// still runs on Date objects (e.g. stepping a premium anniversary forward a
// year). Only the date parts are meaningful — never read a time off it.
export function businessTodayDate(now: Date = new Date()): Date {
  const [year, month, day] = todayIso(now).split('-').map(Number)
  return new Date(year, month - 1, day)
}

// Whole days from `from` (default: business today) until a plain YYYY-MM-DD
// date; negative once the date has passed. Both sides are read as calendar
// dates, so the result never depends on the runtime timezone.
export function daysUntilIso(isoDate: string, from: string = todayIso()): number {
  const utcMidnight = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
    if (!y || !m || !d) return NaN
    return Date.UTC(y, m - 1, d)
  }
  const target = utcMidnight(isoDate)
  const base = utcMidnight(from)
  if (isNaN(target) || isNaN(base)) return NaN
  return Math.round((target - base) / 86_400_000)
}

// Whether a plain investment date is in the future. Client and server both derive
// "today" in the business timezone, so they agree on the boundary and no
// clock-skew allowance is needed: anything past the business day is future-dated.
// Compared as plain dates (ISO strings sort chronologically), so any time portion
// on the input is ignored.
export function isFutureInvestmentDate(isoDate: string, asOf: Date = new Date()): boolean {
  return isoDate.slice(0, 10) > todayIso(asOf)
}
