// Inflation: the assumption layer over the money the app actually holds.
//
// Nothing here reads or rewrites a stored amount. Every transaction, balance and
// target stays exactly as recorded — nominal dong, the number the bank agrees
// with. What this module adds is the second question the ledger can't answer:
// what will that money BUY at the date the user is saving for.
//
// The rate is a forward-looking *assumption*, not a measurement, and the two must
// not be confused. Vietnam's published CPI is an annual fact about a year that has
// already happened (3.31% in 2025, 4.45% over the first eight months of 2026);
// a goal maturing in 2030 depends on the average of years nobody has lived yet.
// So a year coming in above or below the assumption does not make the assumption
// wrong and does not call for a correction — chasing each published figure would
// just feed noise into a long-horizon plan. That is also why the outlook carries a
// SCENARIO BAND rather than a single number: the honest answer to "which rate"
// is a range, and showing three costs nothing over showing one.
import { businessYearMonth } from './dates'

// The assumption a user gets before they've thought about it. Sits between the
// ~3.0%/yr average of 2021-2025 and the ~4.5% the 2026 control target allows —
// mildly conservative against history, which is the right direction to err when
// the output is "how much must I save".
export const DEFAULT_INFLATION_RATE_PCT = 4

// The band shown alongside whatever rate is in force: a historical-average case,
// the default, and a cautious case. Deliberately narrow — a scenario outside the
// range of the official projections (the Ministry of Finance's 2026 scenarios run
// 3.6%-4.6%) would alarm rather than inform.
export const INFLATION_SCENARIO_RATES: readonly number[] = [3, 4, 5]

// Fractional years from the business month until a `YYYY-MM` target, floored at 0.
//
// Unlike `monthsUntilYm` — which floors at 1, because a goal due this month still
// needs one month to save into — a horizon that has closed really is zero here:
// there is no span left for prices to move over, and pretending there's a month
// of it would inflate a target the user is already standing at.
export function yearsUntilYm(ym: string, now: Date = new Date()): number {
  const [y, m] = (ym ?? '').split('-').map(Number)
  if (!y || !m) return 0
  const { year, month } = businessYearMonth(now)
  const months = (y - year) * 12 + (m - month)
  return months > 0 ? months / 12 : 0
}

// How much a price multiplies by over `years` at `ratePct` a year.
//
// COMPOUND, unlike `calcProjectedInterest` in finance.ts, which is linear because
// that is how a held-to-maturity Vietnamese term deposit actually pays. Prices
// compound: 4% over two years is 1.0816, not 1.08, and sharing the deposit helper
// here would quietly understate every horizon longer than a year.
export function inflationFactor(ratePct: number, years: number): number {
  // A closed horizon leaves prices where they are; so does a zero rate. A rate at
  // or below -100%/yr has no compound meaning (money would reach zero and then
  // change sign), so it is refused rather than propagated as NaN.
  if (years <= 0 || ratePct === 0 || ratePct <= -100) return 1
  return (1 + ratePct / 100) ** years
}

// What today's basket costs at the far end of the horizon.
export function futureCost(todayAmount: number, ratePct: number, years: number): number {
  return Math.round(todayAmount * inflationFactor(ratePct, years))
}

// What an amount at the far end of the horizon is worth in today's money.
export function presentValue(futureAmount: number, ratePct: number, years: number): number {
  return Math.round(futureAmount / inflationFactor(ratePct, years))
}

// Which rate governs a given goal: its own, else the user's, else the default.
//
// `??`, not `||`: an explicit 0 is a user telling the app to assume no inflation,
// which is a position, not a missing value. A per-goal rate exists because CPI is
// an average over a basket nobody buys — school fees and general consumer prices
// have not moved together, and a goal saving for one shouldn't be planned with the
// other's number.
export function resolveInflationRate(
  goalRatePct: number | null | undefined,
  userRatePct: number | null | undefined,
): number {
  return goalRatePct ?? userRatePct ?? DEFAULT_INFLATION_RATE_PCT
}

// Not exported: the card reads it off GoalInflationOutlook.scenarios, and an
// exported name nothing imports is drift knip is right to flag.
interface InflationScenario {
  ratePct: number
  targetInFutureMoney: number
  // Whether this band entry is the rate actually in force. False for every entry
  // when the governing rate is off the standard band (a per-goal override), which
  // the UI must not paper over by highlighting the nearest one.
  isCurrent: boolean
}

export interface GoalInflationOutlook {
  ratePct: number
  years: number
  factor: number
  // The same comparison from both ends. In future money the target grows and the
  // savings stay put; in today's money the target stays put and the savings
  // shrink. Both are shown because they answer different questions — "how much
  // more must I put in" vs "what is my idle balance losing" — and they agree by
  // construction, being one division apart.
  targetInFutureMoney: number
  savingsInTodayMoney: number
  gapInFutureMoney: number
  gapInTodayMoney: number
  scenarios: InflationScenario[]
}

/**
 * The inflation view of a goal, or null when there is nothing to say.
 *
 * Null — rather than a neutral all-zeros outlook — for a goal with no target
 * amount, no target date, or a deadline already reached: in each case the honest
 * output is silence, and a card reading "you need 500tr" adds no information the
 * target line didn't already carry.
 *
 * Note what this deliberately does NOT do: touch progress. The progress bar stays
 * nominal money over the nominal target, because that ratio is checkable against
 * the ledger and this one isn't. The outlook sits beside it as commentary, always
 * labelled with the rate it assumed.
 */
export function goalInflationOutlook(
  goal: { targetAmount?: number | null; targetDate?: string | null; currentValue: number },
  ratePct: number,
  now: Date = new Date(),
): GoalInflationOutlook | null {
  const target = goal.targetAmount ?? 0
  if (target <= 0 || !goal.targetDate) return null
  const years = yearsUntilYm(goal.targetDate, now)
  if (years <= 0) return null

  const factor = inflationFactor(ratePct, years)
  const targetInFutureMoney = Math.round(target * factor)
  const savings = Math.max(0, goal.currentValue || 0)
  // Clamped: a goal already worth more than its inflated target is finished, and
  // a negative shortfall would render as "you need -80tr".
  const gapInFutureMoney = Math.max(0, targetInFutureMoney - savings)

  return {
    ratePct,
    years,
    factor,
    targetInFutureMoney,
    savingsInTodayMoney: Math.round(savings / factor),
    gapInFutureMoney,
    // Discounted from the future-money gap rather than computed independently, so
    // the two figures can never drift into telling different stories.
    gapInTodayMoney: Math.round(gapInFutureMoney / factor),
    scenarios: INFLATION_SCENARIO_RATES.map(r => ({
      ratePct: r,
      targetInFutureMoney: futureCost(target, r, years),
      isCurrent: r === ratePct,
    })),
  }
}
