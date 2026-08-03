import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// Settling a premium with no body is the documented "paid today" case, so this
// route derives the business date itself. The server clock is UTC, and between
// 00:00 and 06:59 Vietnam time the UTC date is still *yesterday* — settling the
// premium against the previous day and, at a month boundary, against the
// previous cycle (#591). The route reads the rule from lib/dates; nothing
// pinned it here, which is where it would actually be got wrong (#597).

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  member: {
    data: {
      member_id: 'm1', user_id: 'user-1', member_name: 'Trang',
      annual_payment_vnd: 12_000_000, monthly_premium_vnd: 1_000_000,
      payment_date: '2026-09-15', last_payment_date: '2025-09-15',
      updated_at: '2026-08-01T00:00:00.000Z',
    } as unknown,
    error: null as unknown,
  },
  updated: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/supabase-server', () => {
  const chain = () => {
    const c: Record<string, unknown> = {
      select: () => c,
      eq: () => c,
      update: (payload: Record<string, unknown>) => { h.updated = payload; return c },
      single: async () =>
        h.updated
          ? { data: { updated_at: '2026-08-03T23:30:00.000Z' }, error: null }
          : h.member,
    }
    return c
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: () => chain(),
    }),
  }
})

const { POST } = await import('../route')

const MEMBER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const call = (body?: unknown) =>
  POST(
    new NextRequest('https://app.test/api/v1/insurance-members/x/mark-paid', {
      method: 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ id: MEMBER }) },
  )

describe('POST /api/v1/insurance-members/[id]/mark-paid — business date (#591)', () => {
  beforeEach(() => {
    h.user = { id: 'user-1' }
    h.updated = null
    vi.useFakeTimers()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('settles against the Vietnam day, not the UTC one', async () => {
    // 23:30 UTC on the 3rd is already 06:30 on the 4th in Asia/Ho_Chi_Minh.
    vi.setSystemTime(new Date('2026-08-03T23:30:00Z'))

    const res = await call()

    expect(res.status).toBe(200)
    expect(h.updated).toMatchObject({ last_payment_date: '2026-08-04' })
    expect((await res.json()).data.last_payment_date).toBe('2026-08-04')
  })

  it('crosses the month boundary with the business day, not the UTC one', async () => {
    // The costly case: UTC still says July, Vietnam is already in August, and
    // last_payment_date is what decides which cycle a contribution funds.
    vi.setSystemTime(new Date('2026-07-31T20:00:00Z'))

    await call()

    expect(h.updated).toMatchObject({ last_payment_date: '2026-08-01' })
  })

  it('still honours an explicitly recorded payment date', async () => {
    vi.setSystemTime(new Date('2026-08-03T23:30:00Z'))

    await call({ paid_date: '2026-07-15' })

    expect(h.updated).toMatchObject({ last_payment_date: '2026-07-15' })
  })

  it('stamps updated_at with the instant, which is a UTC timestamp and not the business date', async () => {
    vi.setSystemTime(new Date('2026-08-03T23:30:00Z'))

    await call()

    // The one place the clock is deliberately *not* shifted: updated_at names an
    // instant, so it stays UTC while the business date next to it does not.
    expect(h.updated).toMatchObject({ updated_at: '2026-08-03T23:30:00.000Z' })
  })
})
