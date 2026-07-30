import type { InvRow } from './goalDetailShared'
import type { SellItem } from './SellWithdrawSheet'

// Map a goal-detail investment row to the payload SellWithdrawSheet expects.
// Shared by GoalDetailSheet (mobile) and DesktopGoalDetail so both open the same
// canonical sell/withdraw sheet instead of a per-surface reimplementation (#467).
// Type-only imports keep this a leaf module (no runtime cycle with SellWithdrawSheet).
export function invToSellItem(inv: InvRow): SellItem {
  if (inv.fund) {
    return {
      type: 'fund',
      name: inv.fund.fundName,
      currentValue: inv.fund.currentValue,
      units: inv.fund.quantity,
      navPerUnit: inv.fund.currentNAV,
      gainPct: inv.fund.profitLossPercentage,
      fundId: inv.fund.fundId,
      purchasePrice: inv.fund.purchasePrice,
      // What a sale actually takes out of the bucket (#587). Without it the sheet
      // falls back to posting the PROCEEDS as principal, which the invariant
      // refuses for any fund whose NAV has moved — i.e. every real goal-detail
      // fund sale. The third surface onto the same sheet; the other two pass it.
      costBasis: inv.fund.costBasis,
    }
  }
  const navPerUnit = inv.units && inv.units > 0 ? inv.value / inv.units : undefined
  return {
    type: inv.type as 'bank' | 'gold' | 'stock',
    name: inv.name,
    currentValue: inv.value,
    units: inv.units ?? undefined,
    navPerUnit,
    gainPct: inv.gainPct ?? undefined,
    // The deposit rate drives the sheet's summary / early-withdrawal context.
    interestRate: inv.interestRate ?? undefined,
    transactionId: inv.id, // for a book this is the anchor (= deposit_group_id)
    purchasePrice: inv.principal ?? inv.value,
    depositGroupId: inv.depositGroupId ?? null,
  }
}
