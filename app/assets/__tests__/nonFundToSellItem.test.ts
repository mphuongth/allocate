import { describe, it, expect, vi } from 'vitest'

// DashboardClient pulls in next-intl at module load; stub it so importing the
// pure helper doesn't need a provider.
vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (k: string) => k,
}))

import { nonFundToSellItem, type NonFundUnallocatedItem } from '../DashboardClient'

// A non-fund holding with no user notes — the name then falls back to a type
// label, which must follow the active locale (the bug: it leaked English
// "Bank deposit" / "Gold" into the Vietnamese sell sheet).
const noNotes = (type: string): NonFundUnallocatedItem => ({
  transactionId: 't1', type, amount: 1_000_000, currentValue: 1_000_000,
  interestRate: null, expiryDate: null, investmentDate: '2026-01-01',
  notes: null, units: null, depositGroupId: null,
})

describe('nonFundToSellItem — localised fallback name', () => {
  it('uses Vietnamese labels when isVi is true', () => {
    expect(nonFundToSellItem(noNotes('bank'), true).name).toBe('Tiền gửi')
    expect(nonFundToSellItem(noNotes('gold'), true).name).toBe('Vàng')
  })

  it('uses English labels when isVi is false', () => {
    expect(nonFundToSellItem(noNotes('bank'), false).name).toBe('Bank deposit')
    expect(nonFundToSellItem(noNotes('gold'), false).name).toBe('Gold')
  })

  it('always prefers the user-entered notes over the fallback', () => {
    expect(nonFundToSellItem({ ...noNotes('bank'), notes: 'My TCB deposit' }, true).name).toBe('My TCB deposit')
  })
})
