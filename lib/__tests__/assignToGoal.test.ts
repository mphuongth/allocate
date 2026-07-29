import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { assignInvestmentToGoal } from '../assignToGoal'

// The desktop inline flow and both AssignGoalSheet callbacks carried their own
// copy of these requests, so error handling could be fixed on one surface and
// missed on the others (#571). None of the three had any coverage.

type Handler = (url: string, init?: RequestInit) => { ok: boolean; body?: unknown }

function stubFetch(handler: Handler) {
  const calls: Array<{ url: string; method: string; body: unknown }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    })
    const { ok, body } = handler(url, init)
    return { ok, json: async () => body }
  }))
  return calls
}

const FUND_LIST = [{ id: 'inv-1' }, { id: 'inv-2' }, { id: 'inv-3' }]

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => vi.unstubAllGlobals())

describe('assignInvestmentToGoal — funds', () => {
  it('moves every investment of the fund to the goal', async () => {
    const calls = stubFetch((url) =>
      url.includes('fund-investments?') ? { ok: true, body: FUND_LIST } : { ok: true })

    await assignInvestmentToGoal('fund', 'fund-1', 'goal-1')

    expect(calls[0].url).toBe('/api/v1/fund-investments?fund_id=fund-1')
    // Every investment is PATCHed — a fund row on the dashboard aggregates them.
    expect(calls.slice(1).map((c) => c.url)).toEqual([
      '/api/v1/fund-investments/inv-1/goal',
      '/api/v1/fund-investments/inv-2/goal',
      '/api/v1/fund-investments/inv-3/goal',
    ])
    expect(calls.slice(1).every((c) => c.method === 'PATCH')).toBe(true)
    expect(calls[1].body).toEqual({ goal_id: 'goal-1' })
  })

  it('throws when the investment list cannot be read', async () => {
    stubFetch((url) => (url.includes('fund-investments?') ? { ok: false } : { ok: true }))

    await expect(assignInvestmentToGoal('fund', 'fund-1', 'goal-1'))
      .rejects.toThrow(/failed to fetch fund investments/i)
  })

  // The dashboard shows one row per fund, so a fund that half-moved is a state
  // the user cannot see or correct from the list. It has to surface as an error.
  it('throws when only some of the investments move', async () => {
    stubFetch((url) => {
      if (url.includes('fund-investments?')) return { ok: true, body: FUND_LIST }
      return { ok: !url.includes('inv-2') }
    })

    await expect(assignInvestmentToGoal('fund', 'fund-1', 'goal-1'))
      .rejects.toThrow(/failed to assign/i)
  })

  it('still issues the other requests when one fails — they are not sequenced', async () => {
    const calls = stubFetch((url) => {
      if (url.includes('fund-investments?')) return { ok: true, body: FUND_LIST }
      return { ok: !url.includes('inv-1') }
    })

    await expect(assignInvestmentToGoal('fund', 'fund-1', 'goal-1')).rejects.toThrow()

    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(3)
  })

  it('accepts a fund with no investments as a no-op', async () => {
    stubFetch((url) => (url.includes('fund-investments?') ? { ok: true, body: [] } : { ok: true }))

    await expect(assignInvestmentToGoal('fund', 'fund-1', 'goal-1')).resolves.toBeUndefined()
  })
})

describe('assignInvestmentToGoal — non-funds', () => {
  it('assigns the transaction to the goal', async () => {
    const calls = stubFetch(() => ({ ok: true }))

    await assignInvestmentToGoal('nonFund', 'tx-1', 'goal-1')

    expect(calls).toEqual([{
      url: '/api/v1/investment-transactions/tx-1/assign',
      method: 'PUT',
      body: { goal_id: 'goal-1' },
    }])
  })

  // The route explains *why* it refused — "book is held for merge", say — and
  // the sheet shows that text. Replacing it with a generic message would lose
  // the only explanation the user gets.
  it('surfaces the message the server gave', async () => {
    stubFetch(() => ({ ok: false, body: { error: 'Deposit is held for merge' } }))

    await expect(assignInvestmentToGoal('nonFund', 'tx-1', 'goal-1'))
      .rejects.toThrow('Deposit is held for merge')
  })

  it('falls back to a generic message when the error body is unreadable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      json: async () => { throw new SyntaxError('not JSON') },
    })))

    await expect(assignInvestmentToGoal('nonFund', 'tx-1', 'goal-1'))
      .rejects.toThrow(/failed to assign/i)
  })

  it('falls back when the error body carries no message', async () => {
    stubFetch(() => ({ ok: false, body: {} }))

    await expect(assignInvestmentToGoal('nonFund', 'tx-1', 'goal-1'))
      .rejects.toThrow(/failed to assign/i)
  })
})
