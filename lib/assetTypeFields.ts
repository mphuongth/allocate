/**
 * Which columns of `investment_transactions` belong to which asset type (#593).
 *
 * The table is one wide row shared by every kind of holding, so a fund's NAV
 * columns, a deposit's rate/maturity/bank and gold's units all sit side by side
 * and are all nullable. Editing a transaction can change its type, and the edit
 * payload only ever carried the NEW type's fields — so Bank -> Fund kept the
 * interest rate, maturity and bank code, and Gold -> Bank kept units and unit
 * price. The row then claimed to be two kinds of holding at once, which every
 * later reader (valuation, reports, migrations) has to guess its way through.
 *
 * This module is the single definition of the allowed shape. The edit route
 * clears the old subtype from it, and the DB CHECK constraint added in
 * 20260802000001 enforces the same table.
 */

export type SubtypeAssetType = 'fund' | 'bank' | 'gold' | 'stock'

/**
 * The subtype-specific columns each asset type may carry on an *investment* row.
 * Columns shared by every type (amount_vnd, investment_date, goal_id, notes …)
 * are not listed: they are never contradictory.
 *
 * - fund  — the linked fund plus the NAV pair the units are priced at.
 * - gold  — quantity in chỉ and the price per chỉ; no fund, no deposit terms.
 * - stock — legacy, priced like gold (quantity × price), never a deposit.
 * - bank  — the deposit terms; a deposit has no units, no NAV and no fund.
 *   `deposit_group_id` ties an accumulating book's tranches together, and
 *   `interest_earned_vnd` is what a renewal booked.
 */
export const ASSET_SUBTYPE_FIELDS: Record<SubtypeAssetType, readonly string[]> = {
  fund: ['fund_id', 'units', 'unit_price'],
  gold: ['units', 'unit_price'],
  stock: ['units', 'unit_price'],
  bank: ['interest_rate', 'expiry_date', 'bank_code', 'interest_earned_vnd', 'deposit_group_id'],
}

/** Every column that belongs to at least one asset type but not to all of them. */
export const SUBTYPE_EXCLUSIVE_FIELDS: readonly string[] = [
  ...new Set(Object.values(ASSET_SUBTYPE_FIELDS).flat()),
]

/**
 * The `{ column: null }` patch that clears the previous subtype when a
 * transaction changes asset type.
 *
 * It nulls the WHOLE exclusive set, not merely the columns exclusive to `from`.
 * Two types can share a column and still disagree about what it means — gold
 * `units` are chỉ while fund `units` are shares — so carrying one over would
 * value the new holding off the old quantity. Whatever the new type legitimately
 * has is re-applied afterwards from the request itself, so a caller that sends
 * the new type's fields loses nothing.
 *
 * Returns an empty patch when the type is unchanged, or when the row's previous
 * type is unknown (a legacy row with a null `asset_type` has no subtype to clear).
 */
export function subtypeResetFields(
  from: SubtypeAssetType | string | null | undefined,
  to: SubtypeAssetType,
): Record<string, null> {
  if (!from || from === to) return {}
  return Object.fromEntries(SUBTYPE_EXCLUSIVE_FIELDS.map((field) => [field, null]))
}
