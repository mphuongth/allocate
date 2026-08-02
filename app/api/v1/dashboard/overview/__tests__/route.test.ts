import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SNAPSHOT_WRITE_TIMEOUT_MS } from '@/lib/snapshots'

// A partial dashboard read must never (a) return an understated 200 nor
// (b) overwrite today's net-worth snapshot with the incomplete value (#513).
// We drive the real GET handler over a mocked Supabase whose per-table result
// is configurable, and assert the error gate + snapshot-write guard.
//
// The handler issues, roughly:
//   from(table).select(...).eq(...)                    -> awaited (thenable)
//   from('gold_price_settings').select().eq().single() -> .single()
//   from('net_worth_snapshots').select().eq().eq().maybeSingle()
//   from('plan_*').select().in(...)                    -> awaited (only if planIds)
//   from('net_worth_snapshots').upsert(row).then(...)  -> the snapshot write
const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  tables: {} as Record<string, { data: unknown; error: unknown }>,
  upsertCalls: [] as unknown[],
  // How the snapshot upsert behaves, and whether it had actually settled by the
  // time GET() resolved — the fire-and-forget bug (#592) is precisely a response
  // that finishes while this is still false.
  upsertOutcome: 'ok' as 'ok' | 'error' | 'reject' | 'hang',
  upsertSettled: false,
}))

vi.mock('@/lib/supabase-server', () => {
  /**
   * The snapshot write resolves on a macrotask, so a handler that does not await
   * it returns first — which is what the `upsertSettled` assertions detect.
   */
  function snapshotWrite() {
    if (h.upsertOutcome === 'hang') return new Promise(() => { /* never settles */ })
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        h.upsertSettled = true
        if (h.upsertOutcome === 'reject') reject(new Error('connection reset'))
        else if (h.upsertOutcome === 'error') resolve({ error: { message: 'permission denied' } })
        else resolve({ error: null })
      }, 0)
    })
  }

  function chainFor(name: string) {
    const result = () => h.tables[name] ?? { data: [], error: null }
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      single: async () => result(),
      maybeSingle: async () => result(),
      then: (resolve: (v: unknown) => void) => resolve(result()),
      upsert: (row: unknown) => {
        if (name !== 'net_worth_snapshots') return { then: (r: (v: unknown) => void) => r({ error: null }) }
        h.upsertCalls.push(row)
        return snapshotWrite()
      },
    }
    return chain
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: (name: string) => chainFor(name),
    }),
  }
})

import { GET } from '../route'

const ERR = { code: 'XX000', message: 'connection reset' }

/** Reset every table to a valid, empty-but-successful result. */
function baseHappy() {
  h.tables = {
    monthly_plans: { data: [], error: null },
    savings_goals: { data: [], error: null },
    active_investment_transactions: { data: [], error: null },
    insurance_members: { data: [], error: null },
    insurance_savings: { data: [], error: null },
    recurring_savings: { data: [], error: null },
    gold_price_settings: { data: null, error: null },
    net_worth_snapshots: { data: null, error: null },
    plan_excluded_insurance_members: { data: [], error: null },
    plan_insurance_member_overrides: { data: [], error: null },
    recurring_saving_overrides: { data: [], error: null },
    recurring_saving_fulfillments: { data: [], error: null },
  }
}

/** A single monthly plan so the plan-scoped override queries actually run. */
function withOnePlan() {
  const now = new Date()
  h.tables.monthly_plans = {
    data: [{ id: 'p1', month: now.getMonth() + 1, year: now.getFullYear() }],
    error: null,
  }
}

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.upsertCalls = []
  h.upsertOutcome = 'ok'
  h.upsertSettled = false
  baseHappy()
})

describe('GET /api/v1/dashboard/overview — partial reads never corrupt snapshots (#513)', () => {
  it('returns 200 and writes a snapshot when every source loads', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(h.upsertCalls).toHaveLength(1)
  })

  // Each required source, when it fails, must 500 AND leave the snapshot alone.
  const requiredAlwaysRun = [
    'monthly_plans',
    'savings_goals',
    'active_investment_transactions',
    'insurance_members',
    'insurance_savings',
    'recurring_savings',
    'recurring_saving_fulfillments',
    'net_worth_snapshots',
  ] as const

  for (const table of requiredAlwaysRun) {
    it(`returns 500 and writes no snapshot when ${table} fails`, async () => {
      h.tables[table] = { data: null, error: ERR }
      const res = await GET()
      expect(res.status).toBe(500)
      expect(h.upsertCalls).toHaveLength(0)
    })
  }

  // The plan-scoped queries only run when at least one plan exists.
  const requiredPlanScoped = [
    'plan_excluded_insurance_members',
    'plan_insurance_member_overrides',
    'recurring_saving_overrides',
  ] as const

  for (const table of requiredPlanScoped) {
    it(`returns 500 and writes no snapshot when ${table} fails`, async () => {
      withOnePlan()
      h.tables[table] = { data: null, error: ERR }
      const res = await GET()
      expect(res.status).toBe(500)
      expect(h.upsertCalls).toHaveLength(0)
    })
  }
})

describe('GET /api/v1/dashboard/overview — optional gold price (#513)', () => {
  it('still returns 200 when gold_price_settings has no row (PGRST116)', async () => {
    h.tables.gold_price_settings = { data: null, error: { code: 'PGRST116' } }
    const res = await GET()
    expect(res.status).toBe(200)
    expect(h.upsertCalls).toHaveLength(1)
  })

  it('returns 500 for a real gold_price_settings error (not a missing row)', async () => {
    h.tables.gold_price_settings = { data: null, error: ERR }
    const res = await GET()
    expect(res.status).toBe(500)
    expect(h.upsertCalls).toHaveLength(0)
  })
})

// #592 — the snapshot write used to be fire-and-forget, so on a serverless
// runtime the response could finish (and the instance freeze) before the row
// landed, silently dropping history points.
describe('GET /api/v1/dashboard/overview — snapshot persistence is awaited (#592)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
    vi.useRealTimers()
  })

  it('does not resolve the response until the snapshot write has settled', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(h.upsertSettled).toBe(true)
  })

  it('still returns 200 when the snapshot write fails', async () => {
    h.upsertOutcome = 'error'
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toHaveProperty('netWorth')
  })

  it('logs the failure with user/date context but no financial payload', async () => {
    h.upsertOutcome = 'error'
    await GET()
    expect(errorSpy).toHaveBeenCalledTimes(1)
    const [message, context] = errorSpy.mock.calls[0] as [string, Record<string, unknown>]
    expect(message).toContain('snapshot')
    expect(context).toMatchObject({ user_id: 'user-1', reason: 'permission denied' })
    expect(context.snapshot_date).toEqual(expect.any(String))
    expect(JSON.stringify(context)).not.toContain('total_assets')
  })

  it('still returns 200 when the snapshot write rejects', async () => {
    h.upsertOutcome = 'reject'
    const res = await GET()
    expect(res.status).toBe(200)
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('gives up on a hung write instead of hanging the response', async () => {
    vi.useFakeTimers()
    h.upsertOutcome = 'hang'
    const pending = GET()
    await vi.advanceTimersByTimeAsync(SNAPSHOT_WRITE_TIMEOUT_MS + 1)
    const res = await pending
    expect(res.status).toBe(200)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect((errorSpy.mock.calls[0] as [string, Record<string, unknown>])[1]).toMatchObject({ reason: 'timeout' })
  })

  it('logs nothing when the write succeeds', async () => {
    await GET()
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
