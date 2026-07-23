import { describe, it, expect } from 'vitest'
import { invToSellItem } from '../invToSellItem'
import type { InvRow } from '../goalDetailShared'

// Shared mapper used by both goal-detail surfaces to open the canonical
// SellWithdrawSheet (#467).
describe('invToSellItem', () => {
  it('maps a fund row to a fund SellItem', () => {
    const inv = {
      id: 'row1', type: 'fund', name: 'Fund', value: 3_000_000, units: null, gainPct: null, principal: null,
      fund: { fundId: 'f1', fundName: 'VF1', currentValue: 3_000_000, quantity: 100, currentNAV: 30_000, profitLossPercentage: 12, purchasePrice: 2_680_000 },
    } as unknown as InvRow
    expect(invToSellItem(inv)).toEqual({
      type: 'fund', name: 'VF1', currentValue: 3_000_000, units: 100, navPerUnit: 30_000,
      gainPct: 12, fundId: 'f1', purchasePrice: 2_680_000,
    })
  })

  it('maps a non-fund (bank/gold) row, deriving navPerUnit from value/units', () => {
    const inv = {
      id: 'tx1', type: 'gold', name: 'Gold', value: 2_000_000, units: 2, gainPct: 5, principal: 1_800_000, depositGroupId: null,
      fund: null,
    } as unknown as InvRow
    expect(invToSellItem(inv)).toMatchObject({
      type: 'gold', name: 'Gold', currentValue: 2_000_000, units: 2, navPerUnit: 1_000_000,
      gainPct: 5, transactionId: 'tx1', purchasePrice: 1_800_000, depositGroupId: null,
    })
  })

  it('carries the deposit_group_id so a book withdraws as a full close', () => {
    const inv = { id: 'anchor', type: 'bank', name: 'Book', value: 10_000_000, units: null, gainPct: null, principal: 10_000_000, depositGroupId: 'anchor', fund: null } as unknown as InvRow
    expect(invToSellItem(inv).depositGroupId).toBe('anchor')
    expect(invToSellItem(inv).navPerUnit).toBeUndefined()
  })
})
