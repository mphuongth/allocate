import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stub auth + a thenable query chain. The DELETE handler does:
//   from('funds').select('id').eq().eq().single()   -> existence pre-check
//   from('funds').delete().eq().eq()                 -> awaited, returns { error }
const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  existing: { id: 'f1' } as { id: string } | null,
  deleteError: null as { code?: string } | null,
}))

vi.mock('@/lib/supabase-server', () => {
  function makeChain(kind: 'select' | 'delete' | 'from') {
    const chain: Record<string, unknown> = {
      select: () => makeChain('select'),
      delete: () => makeChain('delete'),
      eq: () => chain,
      single: async () => ({ data: h.existing, error: null }),
      // The delete chain is awaited directly (no .single()).
      then: (resolve: (v: unknown) => void) =>
        resolve(kind === 'delete' ? { error: h.deleteError } : { data: h.existing, error: null }),
    }
    return chain
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: () => makeChain('from'),
    }),
  }
})

import { DELETE } from '../route'

const ctx = { params: Promise.resolve({ id: 'f1' }) }
const req = {} as unknown as Parameters<typeof DELETE>[0]

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.existing = { id: 'f1' }
  h.deleteError = null
})

describe('DELETE /api/funds/[id] — hard-block deleting a fund that is in use (#1)', () => {
  it('returns 204 on a successful delete', async () => {
    const res = await DELETE(req, ctx)
    expect(res.status).toBe(204)
  })

  it('maps a foreign-key violation (23503) to a 409 the UI can act on', async () => {
    h.deleteError = { code: '23503' }
    const res = await DELETE(req, ctx)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('fund_in_use')
  })

  it('still returns 500 for an unexpected delete error', async () => {
    h.deleteError = { code: 'XX000' }
    const res = await DELETE(req, ctx)
    expect(res.status).toBe(500)
  })

  it('returns 404 when the fund does not exist', async () => {
    h.existing = null
    const res = await DELETE(req, ctx)
    expect(res.status).toBe(404)
  })
})
