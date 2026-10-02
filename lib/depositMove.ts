import { calcProjectedInterest } from './finance'

// What a matured term deposit pays out, and the fund units that payout buys
// when it moves to the deposit's target fund instead of being renewed
// (move_deposit_to_fund, 20261001000001).

/**
 * The interest a term deposit pays at maturity: simple interest on the days
 * actually held over a 365-day year — the same accrual the dashboard has been
 * counting in the goal (calcProjectedInterest, capped at maturity), so the
 * payout offered at maturity is the value the goal already shows.
 */
export function interestAtMaturity(dep: {
  principal: number
  rate: number | null
  investmentDate: string
  expiryDate: string | null
}): number {
  if (!dep.expiryDate) return 0
  return Math.round(calcProjectedInterest(dep.principal, dep.rate, dep.investmentDate, dep.expiryDate, Date.parse(dep.expiryDate)))
}

/**
 * The fund units a payout buys at a NAV, to 2 decimal places — the precision
 * the add-transaction form records units at. Null when there is nothing to
 * price. units × NAV stays within half a hundredth of a unit of the payout, so
 * the goal's value does not move when the money does.
 */
export function fundUnitsFor(receivedVnd: number, nav: number | null): number | null {
  if (!(receivedVnd > 0) || !nav || !(nav > 0)) return null
  return Math.round((receivedVnd / nav) * 100) / 100
}
