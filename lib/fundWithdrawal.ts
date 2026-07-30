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
