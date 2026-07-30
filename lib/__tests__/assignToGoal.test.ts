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

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => vi.unstubAllGlobals())

describe('assignInvestmentToGoal — funds', () => {
  // A fund row on the dashboard aggregates every investment of that fund, so the
  // assign has to move all of them. It used to do that client-side: list the fund,
  // then PATCH each id in a Promise.all (#589). The list was unscoped, so
  // assigning the *Unallocated* row moved rows that belonged to other goals too,
  // and a partial failure split the fund across goals. Both are now one request
  // the server executes as a single scoped UPDATE.
  it('moves the fund out of Unallocated in one scoped request', async () => {
    const calls = stubFetch(() => ({ ok: true, body: { moved: 3 } }))

    await assignInvestmentToGoal('fund', 'fund-1', 'goal-1')

    expect(calls).toEqual([{
      url: '/api/v1/fund-investments/assign',
      method: 'POST',
      // from_goal_id: null is the whole point — only unallocated rows move.
      body: { fund_id: 'fund-1', from_goal_id: null, to_goal_id: 'goal-1' },
    }])
  })

  it('never lists or PATCHes individual rows any more', async () => {
    const calls = stubFetch(() => ({ ok: true, body: { moved: 1 } }))

    await assignInvestmentToGoal('fund', 'fund-1', 'goal-1')

    expect(calls.some((c) => c.url.includes('fund-investments?'))).toBe(false)
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false)
  })

  it('surfaces the message the server gave — a concurrent move, for instance', async () => {
    stubFetch(() => ({ ok: false, body: { error: 'This fund has already been moved. Refresh and try again.' } }))

    await expect(assignInvestmentToGoal('fund', 'fund-1', 'goal-1'))
      .rejects.toThrow(/already been moved/i)
  })

  it('falls back to a generic message when the error body is unusable', async () => {
    stubFetch(() => ({ ok: false, body: {} }))

    await expect(assignInvestmentToGoal('fund', 'fund-1', 'goal-1'))
      .rejects.toThrow(/failed to assign/i)
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
