// The monthly savings challenge — the schedule, and where a month stands.
//
// The familiar 30-day challenge, run backwards: pick what a step is worth for
// the month and set aside the most on the 1st, the least on the last day. The
// total is the same in either direction (reversing a sum cannot change it), so
// front-loading costs the user nothing and puts the hard days where the
// enthusiasm is.
//
//   amount(day) = (days in the month + 1 - day) x the month's step
//
// The step is a number the user picks — 1,000 through 10,000, in thousands —
// rather than one of three named tiers. "mức 2" said nothing about what a day
// would cost, and three fixed units skipped the whole middle of the range the
// table this came from actually lays out.
//
// The month's REAL length feeds the schedule, so a 31-day month opens at 31
// steps and February at 28. A fixed 30-row schedule would either invent a 31st
// day nobody can save on or cap a long month a day short.
//
// This mirrors public.savings_challenge_day_amount exactly, on purpose. The
// database is the authority — it recomputes every amount a client sends and
// refuses one that disagrees — and this is what lets the UI show the schedule
// before anything is written, and grey out a control instead of letting the user
// press it and read a refusal.
//
// A TRACKER, not money: nothing here reaches net worth, a goal's progress, or a
// transaction. `savedVnd` is what the user says they set aside, not a balance
// the app can see.

import { businessYearMonth, todayIso } from '@/lib/dates'

const CHALLENGE_UNIT_MIN_VND = 1000
const CHALLENGE_UNIT_MAX_VND = 10000
const CHALLENGE_UNIT_STEP_VND = 1000

// The ten choices, generated rather than listed so the three constants above
// stay the single statement of the range. This is the same rule the database's
// CHECK spells as arithmetic (20260921000001) — widening the range is one edit
// on each side, and the two cannot drift into disagreeing about 11,000.
export const CHALLENGE_UNITS_VND: number[] = Array.from(
  { length: (CHALLENGE_UNIT_MAX_VND - CHALLENGE_UNIT_MIN_VND) / CHALLENGE_UNIT_STEP_VND + 1 },
  (_, i) => CHALLENGE_UNIT_MIN_VND + i * CHALLENGE_UNIT_STEP_VND,
)

/**
 * Is this one of the steps a month can be run at?
 *
 * Checked as arithmetic, not as membership of the array: the array is for the
 * picker to render, and a guard that walked it would quietly start admitting
 * whatever a future edit put in it. The route calls this so an off-grid value
 * comes back as a 400 rather than reaching the database's CHECK as a 500.
 */
export function isChallengeUnitVnd(value: unknown): value is number {
  return (
    typeof value === 'number'
    && Number.isInteger(value)
    && value >= CHALLENGE_UNIT_MIN_VND
    && value <= CHALLENGE_UNIT_MAX_VND
    && value % CHALLENGE_UNIT_STEP_VND === 0
  )
}

// How many days the given business month has.
//
// Built in UTC from the parts — day 0 of the next month is the last day of this
// one — so the answer never depends on the runtime's zone, and month 13 rolls
// the year rather than overflowing. This is calendar arithmetic on a plain
// year/month pair, which is why lib/dates' "never derive a business date from
// the local zone" rule is satisfied rather than sidestepped: no instant, and no
// clock, is consulted at all.
export function daysInBusinessMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

// What the schedule asks for on one day, or 0 for a day this month does not
// have. Zero rather than a throw: every caller's honest answer to "what is due
// on the 31st of September" is "nothing", and the DB trigger reads the same 0 as
// its own out-of-month refusal.
export function challengeDayAmount(
  year: number, month: number, unitVnd: number, day: number,
): number {
  if (!Number.isInteger(day)) return 0
  const days = daysInBusinessMonth(year, month)
  if (day < 1 || day > days) return 0
  return (days + 1 - day) * unitVnd
}

export type ChallengeDay = { day: number; amountVnd: number }

// The whole month, one row per real day, heaviest first.
export function challengeSchedule(
  year: number, month: number, unitVnd: number,
): ChallengeDay[] {
  const days = daysInBusinessMonth(year, month)
  return Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    amountVnd: (days - i) * unitVnd,
  }))
}

export function challengeTotalVnd(year: number, month: number, unitVnd: number): number {
  const days = daysInBusinessMonth(year, month)
  // 1 + 2 + ... + days, scaled. Summing the schedule would give the same number;
  // the closed form is here so the picker can show the month's target beneath
  // all ten steps at once, without building ten schedules of 31 rows to do it.
  return ((days * (days + 1)) / 2) * unitVnd
}

export type ChallengeMonthState = {
  /** The schedule for the chosen step, or empty when none has been picked. */
  schedule: ChallengeDay[]
  /** Days in the month — the denominator, whether or not a step is chosen. */
  totalDays: number
  /** What the whole month asks for. 0 with no step. */
  targetVnd: number
  /** What has actually been ticked. */
  savedVnd: number
  checkedCount: number
  /** savedVnd as a percentage of targetVnd, 0–100. */
  pct: number
  /** What the days that have already passed asked for — the fair yardstick. */
  dueVnd: number
  /** dueVnd - savedVnd, floored at 0. */
  behindVnd: number
  /** Is this the business month? Only then is anything tickable. */
  isCurrentMonth: boolean
  /** Today's day of month, or null when this isn't the business month. */
  today: number | null
  todayAmountVnd: number
  todayChecked: boolean
  /** Mirrors the DB trigger: the step freezes at the first tick. */
  locked: boolean
  canTick: (day: number) => boolean
}

/**
 * Where one month stands — everything the month view and the dashboard card
 * need, derived in one place so the two cannot disagree about a total.
 *
 * `checkedDays` is whatever the server handed back. It is filtered to real days
 * of this month and de-duplicated before anything is summed: the database
 * refuses both shapes, but a view model that trusted the list would overstate
 * what the user has saved, and overstating savings is the one direction that
 * actually misleads.
 */
export function challengeMonthState({
  year, month, unitVnd, checkedDays, now = new Date(),
}: {
  year: number
  month: number
  /** null when the user hasn't picked a step for this month. */
  unitVnd: number | null
  checkedDays: number[]
  now?: Date
}): ChallengeMonthState {
  const totalDays = daysInBusinessMonth(year, month)
  const business = businessYearMonth(now)
  const isCurrentMonth = business.year === year && business.month === month
  const isPast = year < business.year || (year === business.year && month < business.month)
  const today = isCurrentMonth ? businessDayOfMonth(now) : null

  const inMonth = new Set(
    checkedDays.filter(d => Number.isInteger(d) && d >= 1 && d <= totalDays),
  )
  const locked = inMonth.size > 0

  const schedule = unitVnd === null ? [] : challengeSchedule(year, month, unitVnd)
  const targetVnd = unitVnd === null ? 0 : challengeTotalVnd(year, month, unitVnd)
  const savedVnd = unitVnd === null
    ? 0
    : [...inMonth].reduce((acc, d) => acc + challengeDayAmount(year, month, unitVnd, d), 0)

  // What "should" have been set aside by now. A past month is wholly due; a
  // future month asks for nothing yet; the current month is due through today.
  // Measuring the backlog against the month's TOTAL would tell a user on the 2nd
  // that they are hopelessly behind, which is both untrue and the fastest way to
  // make them stop.
  const dueThroughDay = isPast ? totalDays : isCurrentMonth ? (today ?? 0) : 0
  const dueVnd = unitVnd === null
    ? 0
    : schedule.filter(r => r.day <= dueThroughDay).reduce((acc, r) => acc + r.amountVnd, 0)

  return {
    schedule,
    totalDays,
    targetVnd,
    savedVnd,
    checkedCount: inMonth.size,
    pct: targetVnd === 0 ? 0 : (savedVnd / targetVnd) * 100,
    dueVnd,
    behindVnd: Math.max(0, dueVnd - savedVnd),
    isCurrentMonth,
    today,
    todayAmountVnd: unitVnd === null || today === null ? 0 : challengeDayAmount(year, month, unitVnd, today),
    todayChecked: today !== null && inMonth.has(today),
    locked,
    // Ticking is the current month's business only. A past month is history —
    // reopening it would mean a "saved" figure that can still change after the
    // month it describes has ended — and a future day has not happened yet.
    canTick: (day: number) =>
      unitVnd !== null
      && isCurrentMonth
      && today !== null
      && Number.isInteger(day)
      && day >= 1
      && day <= today,
  }
}

// Today's day of month in the business timezone. Split out because deriving it
// is the one place here that consults a clock, and it must go through lib/dates:
// between 00:00 and 06:59 Vietnam time the UTC date is still yesterday, which
// would hide the very day the user is trying to tick (#591).
function businessDayOfMonth(now: Date): number {
  return Number(todayIso(now).slice(8, 10))
}
