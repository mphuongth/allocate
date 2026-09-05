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

// The horizons a goal WITHOUT a deadline is priced at. Most goals never get a
// target month, and the deadline card has nothing to say about them — but
// assuming one ("call it five years") would fabricate the single input the user
// declined to give. A ladder answers honestly: here is the shape of the problem
// at several horizons, pick the one you meant.
export const INFLATION_LADDER_YEARS: readonly number[] = [1, 3, 5, 10]

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

export interface InflationLadder {
  ratePct: number
  steps: { years: number; targetInFutureMoney: number }[]
  // What twelve months of standing still costs the balance already saved,
  // measured in today's money. The one figure here that is about the user's
  // actual holdings rather than about the target, and the one that makes the
  // point without needing any horizon at all.
  yearOneLoss: number
}

/**
 * The inflation view of a goal with a target but NO deadline, or null when there
 * is no target either.
 *
 * Deliberately not a fallback that guesses a date and reuses goalInflationOutlook:
 * the precise card's authority comes from the user having named the month. Say
 * less, rather than say it about a month nobody chose.
 */
export function goalInflationLadder(
  goal: { targetAmount?: number | null; currentValue: number },
  ratePct: number,
): InflationLadder | null {
  const target = goal.targetAmount ?? 0
  if (target <= 0) return null
  const savings = Math.max(0, goal.currentValue || 0)
  return {
    ratePct,
    steps: INFLATION_LADDER_YEARS.map(years => ({
      years,
      targetInFutureMoney: futureCost(target, ratePct, years),
    })),
    yearOneLoss: savings - presentValue(savings, ratePct, 1),
  }
}

export interface RealReturn {
  /** Value-weighted yield across the holdings that state one. */
  nominalRatePct: number
  inflationRatePct: number
  /** What the money actually gains once prices are accounted for. */
  realRatePct: number
  /** The value that yield applies to, and the value it does not cover. */
  ratedValue: number
  unratedValue: number
  /** The real rate as money over the next twelve months, in today's dong. */
  perYear: number
}

/**
 * What a goal's holdings are really earning, or null when nothing states a rate.
 *
 * "Standing still costs you X a year" is false for money that is not standing
 * still, and a goal held in term deposits is earning the whole time. The net is
 * the only honest answer to "am I gaining or losing", and it is a RATIO, not a
 * difference: 5.6% against 4% inflation leaves 1.538%, not 1.6. Subtraction is a
 * decent approximation at small rates and simply the wrong operation.
 *
 * A holding with no stated rate — a fund, gold, a flex deposit — is excluded
 * from the average rather than scored as 0%. Nobody said a fund earns nothing;
 * its forward return is unknown, which is not the same claim. It is returned as
 * `unratedValue` so the caller can say what its answer covers instead of
 * quietly averaging over money the rate was never about.
 */
export function goalRealReturn(
  holdings: { value: number; interestRate: number | null }[],
  inflationRatePct: number,
): RealReturn | null {
  let ratedValue = 0
  let unratedValue = 0
  let weighted = 0
  for (const h of holdings) {
    const value = Math.max(0, h.value || 0)
    if (h.interestRate == null) {
      unratedValue += value
      continue
    }
    ratedValue += value
    weighted += value * h.interestRate
  }
  if (ratedValue <= 0) return null

  const nominalRatePct = weighted / ratedValue
  // Fisher. inflationFactor guards the rate at or below -100% that would make
  // the denominator zero or negative.
  const realRatePct = ((1 + nominalRatePct / 100) / inflationFactor(inflationRatePct, 1) - 1) * 100

  return {
    nominalRatePct,
    inflationRatePct,
    realRatePct,
    ratedValue,
    unratedValue,
    perYear: Math.round(ratedValue * (realRatePct / 100)),
  }
}
