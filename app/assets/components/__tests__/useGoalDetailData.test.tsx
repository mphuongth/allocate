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

  // A book's terms live on its anchor, and the page only holds the newest 200
  // rows — so an old book with recent tranches would otherwise be read off a
  // tranche and appear to still take top-ups after it handed over (#638).
  it('fetches a book anchor that fell outside the page', async () => {
    const urls: string[] = []
    mockFetch((url) => {
      urls.push(url)
      if (url.includes('ids=anchor-1')) {
        return { ok: true, body: { transactions: [{ transaction_id: 'anchor-1', deposit_group_id: 'anchor-1', investment_date: '2025-01-01', successor_deposit_tx_id: 'book-2' }] } }
      }
      if (url.includes('/investment-transactions?')) {
        return { ok: true, body: { transactions: [{ transaction_id: 't9', deposit_group_id: 'anchor-1', investment_date: '2026-05-01' }] } }
      }
      if (url.includes('/recurring-contributions')) return { ok: true, body: { contributions: [] } }
      return { ok: true, body: {} }
    })

    const { result } = renderHook(() => useGoalDetailData({ goalId: 'g1', enabled: true, refreshKey: 0, txReload: 0 }))
    await waitFor(() => expect(result.current.transactions).toHaveLength(2))

    const anchor = result.current.transactions.find(t => t.transaction_id === 'anchor-1')
    expect(anchor?.successor_deposit_tx_id).toBe('book-2')
    // One request for the whole set, not one per anchor.
    expect(urls.filter(u => u.includes('ids=')).length).toBe(1)
  })

  // #638 Phase 4. The books a page has to NAME are not only the ones it groups
  // by: a merged source is dissolved, so it carries no deposit_group_id anyone
  // still points at — only merged_from_book_id on the tranche it paid for. Left
  // out of the backfill, a large goal drops the source off the page and the
  // "Merged from …" line silently disappears. Same for a successor that fell out.
  it('fetches the books a page only needs in order to name them', async () => {
    const asked: string[] = []
    mockFetch((url) => {
      if (url.includes('ids=')) {
        asked.push(url)
        return { ok: true, body: { transactions: [
          { transaction_id: 'A', investment_date: '2025-01-01', notes: 'PVcomBank A' },
          { transaction_id: 'B', deposit_group_id: 'B', investment_date: '2026-02-01', notes: 'PVcomBank B' },
        ] } }
      }
      if (url.includes('/investment-transactions?')) {
        return { ok: true, body: { transactions: [
          // The credited tranche names a source that is off the page...
          { transaction_id: 'credited', deposit_group_id: 'C', investment_date: '2026-08-01', merged_from_book_id: 'A' },
          { transaction_id: 'C', deposit_group_id: 'C', investment_date: '2026-07-01' },
          // ...and a promised book names a successor that is off it too.
          { transaction_id: 'D', deposit_group_id: 'D', investment_date: '2026-06-01', successor_deposit_tx_id: 'B' },
        ] } }
      }
      if (url.includes('/recurring-contributions')) return { ok: true, body: { contributions: [] } }
      return { ok: true, body: {} }
    })

    const { result } = renderHook(() => useGoalDetailData({ goalId: 'g1', enabled: true, refreshKey: 0, txReload: 0 }))
    await waitFor(() => expect(result.current.txLoading).toBe(false))

    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('A')
    expect(asked[0]).toContain('B')
    expect(result.current.transactions.find(t => t.transaction_id === 'A')?.notes).toBe('PVcomBank A')
    expect(result.current.transactions.find(t => t.transaction_id === 'B')?.notes).toBe('PVcomBank B')
  })

  it('asks for every missing anchor, in batches', async () => {
    const urls: string[] = []
    const anchorIds = Array.from({ length: 150 }, (_, i) => `anchor-${i}`)
    mockFetch((url) => {
      urls.push(url)
      if (url.includes('ids=')) {
        const ids = new URL(url, 'https://app.test').searchParams.get('ids')!.split(',')
        return { ok: true, body: { transactions: ids.map(id => ({ transaction_id: id, deposit_group_id: id, investment_date: '2025-01-01' })) } }
      }
      if (url.includes('/investment-transactions?')) {
        return { ok: true, body: { transactions: anchorIds.map((id, i) => ({ transaction_id: `t${i}`, deposit_group_id: id, investment_date: '2026-05-01' })) } }
      }
      if (url.includes('/recurring-contributions')) return { ok: true, body: { contributions: [] } }
      return { ok: true, body: {} }
    })

    const { result } = renderHook(() => useGoalDetailData({ goalId: 'g1', enabled: true, refreshKey: 0, txReload: 0 }))
    await waitFor(() => expect(result.current.transactions).toHaveLength(300))

    // 150 anchors over a 100-id cap: two requests, none of them dropped.
    expect(urls.filter(u => u.includes('ids=')).length).toBe(2)
    expect(result.current.transactions.filter(t => t.transaction_id.startsWith('anchor-'))).toHaveLength(150)
  })

  it('fails the load when an anchor batch fails, rather than rendering a book without its terms', async () => {
    mockFetch((url) => {
      if (url.includes('ids=')) return { ok: false }
      if (url.includes('/investment-transactions?')) {
        return { ok: true, body: { transactions: [{ transaction_id: 't9', deposit_group_id: 'anchor-1', investment_date: '2026-05-01' }] } }
      }
      if (url.includes('/recurring-contributions')) return { ok: true, body: { contributions: [] } }
      return { ok: true, body: {} }
    })

    const { result } = renderHook(() => useGoalDetailData({ goalId: 'g1', enabled: true, refreshKey: 0, txReload: 0 }))
    await waitFor(() => expect(result.current.txError).toBe(true))
    expect(result.current.transactions).toEqual([])
  })

  it('does not ask for anchors the page already has', async () => {
    const urls: string[] = []
    mockFetch((url) => {
      urls.push(url)
      if (url.includes('/investment-transactions?')) {
        return { ok: true, body: { transactions: [
          { transaction_id: 'anchor-1', deposit_group_id: 'anchor-1', investment_date: '2026-01-01' },
          { transaction_id: 't9', deposit_group_id: 'anchor-1', investment_date: '2026-05-01' },
        ] } }
      }
      if (url.includes('/recurring-contributions')) return { ok: true, body: { contributions: [] } }
      return { ok: true, body: {} }
    })

    const { result } = renderHook(() => useGoalDetailData({ goalId: 'g1', enabled: true, refreshKey: 0, txReload: 0 }))
    await waitFor(() => expect(result.current.txLoading).toBe(false))

    expect(urls.some(u => u.includes('ids='))).toBe(false)
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
