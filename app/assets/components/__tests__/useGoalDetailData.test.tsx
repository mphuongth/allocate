import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useGoalDetailData } from '../useGoalDetailData'

// The goal-detail load effect, shared by GoalDetailSheet (mobile) and
// DesktopGoalDetail (#467). Both surfaces now rely on this, so these cases pin
// the parity: merge tx + recurring contributions, sort newest-first, load gold.

function mockFetch(map: (url: string) => { ok: boolean; body?: unknown }) {
  global.fetch = vi.fn(async (url: string | URL | Request) => {
    const r = map(String(url))
    return { ok: r.ok, json: async () => r.body ?? {} } as Response
  }) as unknown as typeof fetch
}

beforeEach(() => vi.restoreAllMocks())

describe('useGoalDetailData (#467)', () => {
  it('merges transactions + recurring contributions newest-first and loads the gold price', async () => {
    mockFetch((url) => {
      if (url.includes('/investment-transactions')) return { ok: true, body: { transactions: [{ transaction_id: 't1', investment_date: '2026-01-01' }] } }
      if (url.includes('/recurring-contributions')) return { ok: true, body: { contributions: [{ transaction_id: 'r1', investment_date: '2026-03-01' }] } }
      if (url.includes('/gold-price')) return { ok: true, body: { price_per_chi: 7_500_000 } }
      return { ok: false }
    })
    const { result } = renderHook(() => useGoalDetailData({ goalId: 'g1', enabled: true, refreshKey: 0, txReload: 0 }))
    await waitFor(() => expect(result.current.txLoading).toBe(false))
    // Newest first: the March recurring contribution precedes the January tx.
    expect(result.current.transactions.map(t => t.transaction_id)).toEqual(['r1', 't1'])
    expect(result.current.goldPricePerChi).toBe(7_500_000)
    expect(result.current.txError).toBe(false)
  })

  it('does not fetch while disabled', async () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as unknown as typeof fetch
    renderHook(() => useGoalDetailData({ goalId: 'g1', enabled: false, refreshKey: 0, txReload: 0 }))
    await new Promise(r => setTimeout(r, 10))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('sets txError and empties the list when the transactions fetch fails', async () => {
    mockFetch((url) => {
      if (url.includes('/investment-transactions')) return { ok: false }
      return { ok: true, body: {} }
    })
    const { result } = renderHook(() => useGoalDetailData({ goalId: 'g1', enabled: true, refreshKey: 0, txReload: 0 }))
    await waitFor(() => expect(result.current.txError).toBe(true))
    expect(result.current.transactions).toEqual([])
  })

  it('degrades to just the transactions when recurring contributions fail', async () => {
    mockFetch((url) => {
      if (url.includes('/investment-transactions')) return { ok: true, body: { transactions: [{ transaction_id: 't1', investment_date: '2026-01-01' }] } }
      if (url.includes('/recurring-contributions')) return { ok: false }
      return { ok: true, body: {} }
    })
    const { result } = renderHook(() => useGoalDetailData({ goalId: 'g1', enabled: true, refreshKey: 0, txReload: 0 }))
    await waitFor(() => expect(result.current.txLoading).toBe(false))
    expect(result.current.transactions.map(t => t.transaction_id)).toEqual(['t1'])
    expect(result.current.txError).toBe(false)
  })

  it('fires onLoadStart at the beginning of each load', async () => {
    mockFetch(() => ({ ok: true, body: {} }))
    const onLoadStart = vi.fn()
    renderHook(() => useGoalDetailData({ goalId: 'g1', enabled: true, refreshKey: 0, txReload: 0, onLoadStart }))
    await waitFor(() => expect(onLoadStart).toHaveBeenCalled())
  })
})
