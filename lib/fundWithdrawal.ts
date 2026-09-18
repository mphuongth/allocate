// The cost basis a fund sale takes out of its holding, shared by both sell
// surfaces (AddTransactionSheet via addTransactionModel, and SellWithdrawSheet).
//
// ONE authoritative basis: `amount_vnd` — what the purchases actually cost,
// fees included. That is not a preference, it is where the number lands:
// dashboard/overview reduces the bucket by
//
//   acc.totalInvested -= Σ principal_withdrawn        // the invested/amount basis
//   acc.totalNavCost  -= (units sold / units held) × totalNavCost
//
// so `principal_withdrawn` is subtracted from the AMOUNT basis, while the NAV cost
// (Σ units × unit_price, fees excluded) is reduced by units and exists only to
// derive the average entry price for display.
//
// Both sheets used to reconstruct the basis the other way round:
//
//   Math.round((sellAmount / currentValue) * (purchasePrice * units))
//
// where `purchasePrice` is itself `totalNavCost / totalUnits`. That divides, then
// multiplies back, then rounds — so the figure posted was (a) NAV-based, subtracted
// from an amount-based accumulator, and (b) carrying the error of a round trip
// through an average. It could land a đồng or two above the real basis, which is
// how it first surfaced: the #587 invariant refused an ordinary "sell everything",
// and the trigger was given a tolerance to paper over it. Fixing the arithmetic
// where it happens is the better end state — whatever the trigger tolerates is
// money that stops being checked.
//
// So: the total remaining basis comes from the dashboard as a number
// (`costBasis`), a full sale takes it exactly, and a partial sale is allocated by
// UNITS out of that total — the same proportion the overview itself uses.

export function fundCostBasis(input: {
  /** Remaining basis of the (goal, fund) bucket: Σ amount_vnd, net of prior sells. */
  totalBasis: number | null | undefined
  /** Units the bucket still holds. */
  totalUnits: number | null | undefined
  /** Units being sold. */
  sellUnits: number
}): number | null {
  const { totalBasis, totalUnits, sellUnits } = input
  if (totalBasis == null || !totalUnits || totalUnits <= 0) return null
  if (!(sellUnits > 0)) return 0
  // Selling the lot (or more than the record shows) takes the whole basis. Stated,
  // not derived, so no arithmetic can push it above what the holding cost.
  if (sellUnits >= totalUnits) return Math.round(totalBasis)
  return Math.round((sellUnits * totalBasis) / totalUnits)
}

/**
 * The three figures a fund sale posts, which are three different numbers:
 *
 *   units_withdrawn   — how many units left the holding
 *   principal_withdrawn — how much of the cost basis went with them
 *   amount_vnd        — how much cash actually arrived
 *
 * Both sell surfaces used to derive all three from one field, the amount typed
 * into "sell". That is fine while the cash equals units × price, and wrong the
 * moment it does not: a brokerage fee and the 0.1% sale tax on a listed
 * certificate, or an open-ended fund's early-redemption fee, all make the cash
 * smaller than the units are worth. A user correcting the amount to match their
 * broker's confirmation was silently correcting the QUANTITY too — selling 100
 * certificates and recording 99.77, leaving a quarter of a certificate in the
 * holding that nothing would ever clear.
 *
 * So the quantity comes from the gross (units × current price, the field that
 * decides how much of the holding is going), the basis comes from the quantity,
 * and only the cash comes from what the user says they received. The app does
 * not compute the fee or the tax: brokerage rates are tiered, odd lots fill at
 * their own price, and only the confirmation slip knows the real figure — the
 * same reason a bank withdrawal has had an editable "received" since #578.
 */
export function fundSaleFigures(input: {
  /** Cash value of the units being sold, at the current price. */
  gross: number
  /** Current price per unit; null when unknown, and then the whole holding goes. */
  navPerUnit: number | null | undefined
  /** Units the bucket still holds. */
  heldUnits: number | null | undefined
  /** Remaining cost basis of the bucket. */
  totalBasis: number | null | undefined
  /** Cash actually received, net of fees and tax. Absent or zero = the gross. */
  received?: number | null
}): { units: number; principal: number; proceeds: number; gain: number } {
  const { gross, navPerUnit, heldUnits, totalBasis, received } = input

  // Rounded FIRST: these are the units the basis is allocated from and the units
  // that get posted, so the two must not disagree at the 4th decimal (#587).
  const units = parseFloat((navPerUnit ? gross / navPerUnit : (heldUnits ?? 0)).toFixed(4))
  const principal = fundCostBasis({ totalBasis, totalUnits: heldUnits, sellUnits: units }) ?? Math.round(gross)
  const proceeds = Math.round(received ? received : gross)

  return { units, principal, proceeds, gain: proceeds - principal }
}
