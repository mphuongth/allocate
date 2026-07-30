import { describe, it, expect, vi, beforeEach } from 'vitest'
import { deleteGoal, unholdTransaction, unassignInvestment, updateGoal } from '../goalActions'

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
    // Returns a result object now, not a boolean: a refused unhold has to carry
    // *why* so the caller can say something useful (#550). Both call sites did
    // `const ok = await unholdTransaction(...)` — with an object that is always
    // truthy, so their error branch would silently never run.
    expect(await unholdTransaction('tx1')).toEqual({ ok: true })
    expect(calls[0].url).toBe('/api/v1/investment-transactions/tx1')
    expect(calls[0].init?.method).toBe('DELETE')
  })

  it('unholdTransaction reports the refusal code', async () => {
    mockFetch(() => ({ ok: false, body: { error: 'already merged', code: 'settlement_consumed' } }))
    expect(await unholdTransaction('tx1')).toEqual({ ok: false, code: 'settlement_consumed' })
  })

  // A fund unassign used to list the goal's rows and PATCH each one back to null
  // in a Promise.all — a partial failure left the fund split between the goal and
  // Unallocated (#589). It is now the same single scoped UPDATE the assign uses,
  // in the opposite direction, so the two can't interleave into a split fund.
  it('unassignInvestment (fund) moves the fund out of the goal in one scoped request', async () => {
    const calls = mockFetch(() => ({ ok: true, body: { moved: 2 } }))
    expect(await unassignInvestment({ id: 'row1', fund: { fundId: 'f1' } }, 'goal-1')).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/api/v1/fund-investments/assign')
    expect(calls[0].init?.method).toBe('POST')
    // Scoped to this goal so a fund split across goals isn't cleared elsewhere.
    expect(JSON.parse(String(calls[0].init?.body)))
      .toEqual({ fund_id: 'f1', from_goal_id: 'goal-1', to_goal_id: null })
  })

  it('unassignInvestment (fund) returns false when the move is refused', async () => {
    mockFetch(() => ({ ok: false, body: { error: 'nothing left to move' } }))
    expect(await unassignInvestment({ id: 'row1', fund: { fundId: 'f1' } }, 'goal-1')).toBe(false)
  })

  it('unassignInvestment (single tx) PUTs assign goal_id=null', async () => {
    const calls = mockFetch(() => ({ ok: true }))
    expect(await unassignInvestment({ id: 'tx1', fund: null }, 'goal-1')).toBe(true)
    expect(calls[0].url).toBe('/api/v1/investment-transactions/tx1/assign')
    expect(calls[0].init?.method).toBe('PUT')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ goal_id: null })
  })

  it('unassignInvestment (fund) returns false when the request never lands', async () => {
    global.fetch = vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch
    expect(await unassignInvestment({ id: 'row1', fund: { fundId: 'f1' } }, 'goal-1')).toBe(false)
  })
})

// updateGoal was duplicated in EditGoalSheet (mobile) + EditGoalModal (desktop);
// desktop additionally sends target_date. Callers pass `date` only when they own a
// date field, so the request must omit target_date entirely when it's absent.
describe('goalActions.updateGoal (#467)', () => {
  it('PATCHes goal_name + target_amount (mobile shape omits target_date)', async () => {
    const calls = mockFetch(() => ({ ok: true }))
    const r = await updateGoal('g1', { name: 'House', target: 500_000_000 })
    expect(r).toEqual({ ok: true })
    expect(calls[0].url).toBe('/api/v1/savings-goals/g1')
    expect(calls[0].init?.method).toBe('PATCH')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ goal_name: 'House', target_amount: 500_000_000 })
  })

  it('includes target_date when the caller supplies a date (desktop shape)', async () => {
    const calls = mockFetch(() => ({ ok: true }))
    await updateGoal('g1', { name: 'House', target: 500_000_000, date: '2027-06-01' })
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      goal_name: 'House', target_amount: 500_000_000, target_date: '2027-06-01',
    })
  })

  it('sends target_amount null and target_date null when cleared', async () => {
    const calls = mockFetch(() => ({ ok: true }))
    await updateGoal('g1', { name: 'House', target: null, date: null })
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      goal_name: 'House', target_amount: null, target_date: null,
    })
  })

  it('surfaces the server error body on a non-OK response', async () => {
    mockFetch(() => ({ ok: false, body: { error: 'Name already used' } }))
    expect(await updateGoal('g1', { name: 'House', target: null })).toEqual({ ok: false, error: 'Name already used' })
  })

  it('flags a network error when fetch throws', async () => {
    global.fetch = vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch
    expect(await updateGoal('g1', { name: 'House', target: null })).toEqual({ ok: false, networkError: true })
  })
})
