import { describe, it, expect, vi, beforeEach } from 'vitest'
import { deleteGoal, unholdTransaction, unassignInvestment } from '../goalActions'

// Shared goal-detail mutations (#467) — both surfaces call these, so the cases
// pin the parity: right endpoint/method, and the fund vs single-tx unassign flow.

function mockFetch(handler: (url: string, init?: RequestInit) => { ok: boolean; body?: unknown }) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, init })
    const r = handler(u, init)
    return { ok: r.ok, json: async () => r.body ?? {} } as Response
  }) as unknown as typeof fetch
  return calls
}

beforeEach(() => vi.restoreAllMocks())

describe('goalActions (#467)', () => {
  it('deleteGoal DELETEs the goal and reports the result', async () => {
    const calls = mockFetch(() => ({ ok: true }))
    expect(await deleteGoal('g1')).toBe(true)
    expect(calls[0].url).toBe('/api/v1/savings-goals/g1')
    expect(calls[0].init?.method).toBe('DELETE')
  })

  it('deleteGoal returns false on a non-OK response or a network error', async () => {
    mockFetch(() => ({ ok: false }))
    expect(await deleteGoal('g1')).toBe(false)
    global.fetch = vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch
    expect(await deleteGoal('g1')).toBe(false)
  })

  it('unholdTransaction DELETEs the held row', async () => {
    const calls = mockFetch(() => ({ ok: true }))
    expect(await unholdTransaction('tx1')).toBe(true)
    expect(calls[0].url).toBe('/api/v1/investment-transactions/tx1')
    expect(calls[0].init?.method).toBe('DELETE')
  })

  // GET /fund-investments returns a BARE ARRAY (matches the real route), not
  // { investments: [...] } — a wrong mock here would hide the #467 no-op bug.
  it('unassignInvestment (fund) scopes the query to the goal and PATCHes each row back to null', async () => {
    const calls = mockFetch((url, init) => {
      if (url.includes('/fund-investments?fund_id=')) return { ok: true, body: [{ id: 'fi1' }, { id: 'fi2' }] }
      if (init?.method === 'PATCH') return { ok: true }
      return { ok: false }
    })
    expect(await unassignInvestment({ id: 'row1', fund: { fundId: 'f1' } }, 'goal-1')).toBe(true)
    // Scoped to the goal so a fund split across goals isn't cleared elsewhere.
    expect(calls[0].url).toBe('/api/v1/fund-investments?fund_id=f1&goal_id=goal-1')
    const patched = calls.filter(c => c.init?.method === 'PATCH').map(c => c.url)
    expect(patched).toEqual(['/api/v1/fund-investments/fi1/goal', '/api/v1/fund-investments/fi2/goal'])
    expect(JSON.parse(String(calls.find(c => c.init?.method === 'PATCH')!.init!.body))).toEqual({ goal_id: null })
  })

  it('unassignInvestment (fund) returns false when any PATCH fails', async () => {
    mockFetch((url, init) => {
      if (url.includes('/fund-investments?fund_id=')) return { ok: true, body: [{ id: 'fi1' }, { id: 'fi2' }] }
      if (init?.method === 'PATCH') return { ok: url.includes('fi1') }
      return { ok: false }
    })
    expect(await unassignInvestment({ id: 'row1', fund: { fundId: 'f1' } }, 'goal-1')).toBe(false)
  })

  it('unassignInvestment (single tx) PUTs assign goal_id=null', async () => {
    const calls = mockFetch(() => ({ ok: true }))
    expect(await unassignInvestment({ id: 'tx1', fund: null }, 'goal-1')).toBe(true)
    expect(calls[0].url).toBe('/api/v1/investment-transactions/tx1/assign')
    expect(calls[0].init?.method).toBe('PUT')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ goal_id: null })
  })

  it('unassignInvestment (fund) returns false when the fund-investments fetch fails', async () => {
    mockFetch(() => ({ ok: false }))
    expect(await unassignInvestment({ id: 'row1', fund: { fundId: 'f1' } }, 'goal-1')).toBe(false)
  })
})
