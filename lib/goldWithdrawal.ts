// Cost basis of the gold being sold, shared by the two sell surfaces
// (AddTransactionSheet via addTransactionModel, and SellWithdrawSheet).
//
// Both used to derive it through a rounded per-unit price:
//
//   const goldBuyUnit = Math.round(purchasePrice / units)
//   const goldCost    = Math.round(qty * goldBuyUnit)
//
// which rounds twice. Whenever the remaining principal isn't divisible by the
// units, that drifts above the real basis: one lượng bought for 123,456,789 has
// a per-unit price of 12,345,679 (rounded up from …8.9), so selling all 10 chỉ
// posts 123,456,790 — one đồng more principal than the holding has. The server
// now measures a withdrawal against the balance (#587), so that đồng is the
// difference between "sell all" working and being refused as an overdraw.
//
// Dividing once fixes it, and a full sell is stated exactly rather than derived:
// selling everything takes the whole remaining basis, whatever it is.
//
// The rounded per-unit figure is still fine for DISPLAY ("2 chỉ × 12,345,679"),
// which is all it was ever meant for.

export function goldCostBasis(input: {
  /** Principal still in the holding, before this sale. */
  currentPrincipal: number | null | undefined
  /** Units (chỉ) the holding still has. */
  units: number | null | undefined
  /** Units (chỉ) being sold. */
  sellUnits: number
}): number | null {
  const { currentPrincipal, units, sellUnits } = input
  if (currentPrincipal == null || !units || units <= 0) return null
  // Selling the lot (or more than the record shows) takes the whole basis. No
  // arithmetic, so no rounding: the sale can never claim more than the holding.
  if (sellUnits >= units) return Math.round(currentPrincipal)
  return Math.round((sellUnits * currentPrincipal) / units)
}

/** The per-unit purchase price, for display only. */
export function goldUnitCost(currentPrincipal: number | null | undefined, units: number | null | undefined): number | null {
  if (currentPrincipal == null || !units || units <= 0) return null
  return Math.round(currentPrincipal / units)
}
