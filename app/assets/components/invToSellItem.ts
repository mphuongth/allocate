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
    transactionId: inv.id, // for a book this is the anchor (= deposit_group_id)
    purchasePrice: inv.principal ?? inv.value,
    depositGroupId: inv.depositGroupId ?? null,
  }
}
