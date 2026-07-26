import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// "Last synced" reduces the newest updated_at across two sources (funds NAV and
// gold settings). Both queries dropped their error, so a failed source silently
// contributed nothing to the reduce — the card then showed the *other* source's
// older timestamp, or "never synced", as if that were the truth (#533).
//
// Both queries already use maybeSingle(), so a user who simply owns no funds or
// has no gold settings is a legitimate `data: null` with no error. That case must
// keep returning a 200 — only a real failure may 500.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  results: {} as Record<string, { data: unknown; error: unknown }>,
}))

vi.mock('@/lib/supabase-server', () => {
  const chainFor = (table: string) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => h.results[table] ?? { data: null, error: null },
    }
    return chain
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: (table: string) => chainFor(table),
    }),
  }
})

const { GET } = await import('../route')

const FUNDS_SYNC = '2026-07-20T08:00:00.000Z'
const GOLD_SYNC = '2026-07-26T09:30:00.000Z'

describe('GET /api/v1/prices/last-sync', () => {
  beforeEach(() => {
    h.user = { id: 'user-1' }
    h.results = {}
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    h.user = null
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns the newest timestamp across both sources', async () => {
    h.results.funds = { data: { updated_at: FUNDS_SYNC }, error: null }
    h.results.gold_price_settings = { data: { updated_at: GOLD_SYNC }, error: null }
    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ lastSync: GOLD_SYNC })
  })

  it('returns null when the user has neither funds nor gold settings', async () => {
    h.results.funds = { data: null, error: null }
    h.results.gold_price_settings = { data: null, error: null }
    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ lastSync: null })
  })

  it('still returns 200 when only one source has data', async () => {
    h.results.funds = { data: { updated_at: FUNDS_SYNC }, error: null }
    h.results.gold_price_settings = { data: null, error: null }
    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ lastSync: FUNDS_SYNC })
  })

  // The dangerous shape: gold is genuinely newer, but its read failed. Reducing
  // over the survivors reports the stale funds timestamp as the last sync.
  it('fails closed with 500 when the gold read errors', async () => {
    h.results.funds = { data: { updated_at: FUNDS_SYNC }, error: null }
    h.results.gold_price_settings = { data: null, error: { message: 'timeout' } }
    const res = await GET()
    expect(res.status).toBe(500)
  })

  it('fails closed with 500 when the funds read errors', async () => {
    h.results.funds = { data: null, error: { message: 'timeout' } }
    h.results.gold_price_settings = { data: { updated_at: GOLD_SYNC }, error: null }
    const res = await GET()
    expect(res.status).toBe(500)
  })

  it('does not leak the database message to the client', async () => {
    h.results.funds = { data: null, error: { message: 'relation "funds" does not exist' } }
    const res = await GET()
    expect(JSON.stringify(await res.json())).not.toContain('does not exist')
  })
})
