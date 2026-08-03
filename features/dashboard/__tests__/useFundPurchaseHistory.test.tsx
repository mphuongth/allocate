import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useFundPurchaseHistory } from '../useFundPurchaseHistory'

// The fund-detail modal's purchase history (#602). Extracted from
// DashboardClient's `handleFundClick`, which owned three pieces of state and
// the sort order inline.

const row = (over: Record<string, unknown> = {}) => ({
  nav_at_purchase: 20_000,
  units_purchased: 10,
  investment_date: '2026-01-15',
  created_at: '2026-01-20T00:00:00Z',
  ...over,
})

afterEach(() => { vi.unstubAllGlobals() })

describe('useFundPurchaseHistory', () => {
  it('loads a fund’s purchases, newest first', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [row({ investment_date: '2026-01-01' }), row({ investment_date: '2026-03-01' })],
    }))
    const { result } = renderHook(() => useFundPurchaseHistory())

    await act(async () => { await result.current.open('f1') })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.fundId).toBe('f1')
    expect(result.current.items.map((i) => i.purchase_date)).toEqual(['2026-03-01', '2026-01-01'])
    expect(result.current.failed).toBe(false)
  })

  it('falls back to created_at when a row has no investment date', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [row({ investment_date: null })],
    }))
    const { result } = renderHook(() => useFundPurchaseHistory())

    await act(async () => { await result.current.open('f1') })
    expect(result.current.items[0].purchase_date).toBe('2026-01-20T00:00:00Z')
  })

  it('distinguishes a failed load from a genuinely empty history', async () => {
    // Both render zero rows; only one of them should say "couldn't load".
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    const { result } = renderHook(() => useFundPurchaseHistory())

    await act(async () => { await result.current.open('f1') })
    expect(result.current.items).toEqual([])
    expect(result.current.failed).toBe(true)
    expect(result.current.loading).toBe(false)
  })

  it('clears the previous fund’s rows when opening another', async () => {
    // Otherwise the modal briefly shows the last fund's purchases under the new
    // fund's name while the request is in flight.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [row()] })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useFundPurchaseHistory())
    await act(async () => { await result.current.open('f1') })
    expect(result.current.items).toHaveLength(1)

    let pending!: Promise<void>
    fetchMock.mockImplementation(() => new Promise(() => {})) // never resolves
    act(() => { pending = result.current.open('f2') })
    expect(result.current.items).toEqual([])
    expect(result.current.loading).toBe(true)
    void pending
  })

  it('closes back to no selected fund', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [row()] }))
    const { result } = renderHook(() => useFundPurchaseHistory())
    await act(async () => { await result.current.open('f1') })

    act(() => { result.current.close() })
    expect(result.current.fundId).toBeNull()
  })
})
