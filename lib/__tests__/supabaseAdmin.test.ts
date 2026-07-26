import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The service-role client must be buildable only at request time, and must
// report missing runtime configuration instead of throwing supabase-js's raw
// `supabaseKey is required.` (#536).

const h = vi.hoisted(() => ({
  clients: [] as { url: string; key: string }[],
}))

vi.mock('@supabase/supabase-js', () => ({
  // Mirrors the real library, which throws on a falsy url/key — the helper must
  // pre-empt that with its own null return, never let it surface.
  createClient: (url: string, key: string) => {
    if (!url) throw new Error('supabaseUrl is required.')
    if (!key) throw new Error('supabaseKey is required.')
    h.clients.push({ url, key })
    return { marker: 'admin-client' }
  },
}))

const ORIGINAL_ENV = process.env

describe('createSupabaseAdminClient', () => {
  beforeEach(() => {
    h.clients.length = 0
    process.env = {
      ...ORIGINAL_ENV,
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    }
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
  })

  it('builds a client from the runtime env', async () => {
    const { createSupabaseAdminClient } = await import('../supabase-admin')
    expect(createSupabaseAdminClient()).toEqual({ marker: 'admin-client' })
    expect(h.clients).toEqual([{ url: 'https://test.supabase.co', key: 'service-role-key' }])
  })

  it('returns null instead of throwing when the service-role key is missing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const { createSupabaseAdminClient } = await import('../supabase-admin')
    expect(createSupabaseAdminClient()).toBeNull()
    expect(h.clients).toEqual([])
  })

  it('returns null when the Supabase URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    const { createSupabaseAdminClient } = await import('../supabase-admin')
    expect(createSupabaseAdminClient()).toBeNull()
    expect(h.clients).toEqual([])
  })

  it('treats an empty-string secret as missing', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = ''
    const { createSupabaseAdminClient } = await import('../supabase-admin')
    expect(createSupabaseAdminClient()).toBeNull()
  })

  it('reads the env on every call, not once at module load', async () => {
    const { createSupabaseAdminClient } = await import('../supabase-admin')
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(createSupabaseAdminClient()).toBeNull()
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'late-key'
    expect(createSupabaseAdminClient()).toEqual({ marker: 'admin-client' })
  })
})
