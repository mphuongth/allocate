import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SellWithdrawSheet } from '../SellWithdrawSheet'

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string) => key,
}))

beforeEach(() => {
  document.body.style.overflow = ''
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})

describe('SellWithdrawSheet — gold sell (quantity × price) (issue #232)', () => {
  it('prefills the price and posts proceeds + cost basis', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
    vi.stubGlobal('fetch', fetchMock)

    const item = {
      type: 'gold' as const, name: 'PNJ Gold',
      currentValue: 9_200_000, units: 1, navPerUnit: 9_200_000,
      transactionId: 'g1', purchasePrice: 9_000_000,
    }
    render(<SellWithdrawSheet item={item} open context="unallocated" onClose={vi.fn()} onSuccess={vi.fn()} />)

    // Sale price prefills to the current price (9,200,000); sell 1 chỉ.
    fireEvent.change(screen.getByTestId('sell-gold-qty-input'), { target: { value: '1' } })
    fireEvent.click(screen.getByTestId('sell-confirm-btn'))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String(c[0]).includes('/investment-transactions'))
      expect(post).toBeTruthy()
      const body = JSON.parse(String((post![1] as RequestInit).body))
      expect(body.asset_type).toBe('gold')
      expect(body.parent_transaction_id).toBe('g1')
      expect(body.units_withdrawn).toBe(1)            // 1 chỉ
      expect(body.amount_vnd).toBe(9_200_000)         // proceeds = 1 × current price
      expect(body.principal_withdrawn).toBe(9_000_000) // cost basis = 9,000,000 / 1 × 1
    })
  })
})
