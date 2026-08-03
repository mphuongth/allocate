import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DashboardData } from '@/features/dashboard/contracts'

// The report endpoint used to render whatever DashboardData the client posted:
// an authenticated user could forge every figure in their own PDF, and could
// post an arbitrarily large or deeply nested payload for the server to render
// (#594). The route now derives the data server-side from the caller's own
// holdings, accepts nothing but a locale, caps the body, and is rate limited.
const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  overview: { ok: true, data: {} as DashboardData } as { ok: boolean; data?: DashboardData },
  overviewCalls: [] as unknown[],
  rateLimit: { data: [{ allowed: true, retry_after_seconds: 0 }] as unknown, error: null as unknown },
  rpcCalls: [] as string[],
  rendered: [] as { data: DashboardData; locale?: string }[],
}))

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    rpc: (name: string) => {
      h.rpcCalls.push(name)
      return { then: (resolve: (v: unknown) => void) => resolve(h.rateLimit) }
    },
  }),
}))

vi.mock('@/lib/dashboardOverview', () => ({
  buildDashboardOverview: async (supabase: unknown, userId: string) => {
    h.overviewCalls.push(userId)
    return h.overview
  },
}))

// The real report component pulls in @react-pdf's font registration and reads
// files from disk; the element's props are what this test is about, so both the
// component and the renderer are stubbed and the renderer records those props —
// that is how "the numbers came from the server" is asserted.
vi.mock('@/components/report/PortfolioReport', () => ({
  PortfolioReport: () => null,
}))

vi.mock('@react-pdf/renderer', () => ({
  renderToBuffer: async (element: { props: { data: DashboardData; locale?: string } }) => {
    h.rendered.push(element.props)
    return Buffer.from('%PDF-1.4 fake')
  },
}))

const { POST } = await import('../route')

const SERVER_DATA = {
  netWorth: {
    totalAssets: 500_000_000, totalLiabilities: 0, netWorth: 500_000_000,
    totalInvested: 400_000_000, currentValue: 500_000_000,
    overallProfitLoss: 100_000_000, overallProfitLossPercentage: 25,
    navStale: false, hasGold: false, navUpdatedAt: null,
  },
  goals: [],
  unallocated: { totalValue: 0, funds: [], nonFunds: [] },
  byType: { bank: 500_000_000, gold: 0, stock: 0 },
  insurance: [],
} as DashboardData

const post = (body?: unknown, init?: RequestInit) =>
  new Request('http://localhost/api/v1/report', {
    method: 'POST',
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    ...init,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.overview = { ok: true, data: SERVER_DATA }
  h.overviewCalls = []
  h.rateLimit = { data: [{ allowed: true, retry_after_seconds: 0 }], error: null }
  h.rpcCalls = []
  h.rendered = []
})

describe('POST /api/v1/report', () => {
  it('rejects an unauthenticated request', async () => {
    h.user = null
    const res = await POST(post({ locale: 'vi' }))

    expect(res.status).toBe(401)
    expect(h.overviewCalls).toEqual([])
    expect(h.rendered).toEqual([])
  })

  it('renders the PDF from server-derived data for the authenticated user', async () => {
    const res = await POST(post({ locale: 'vi' }))

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(h.overviewCalls).toEqual(['user-1'])
    expect(h.rendered[0].data).toEqual(SERVER_DATA)
  })

  // The core of #594: figures posted by the client are ignored entirely. Kept
  // small enough to pass the size cap, so what's asserted is that the data was
  // *ignored* rather than that the request was refused for being too big.
  it('ignores client-supplied report data', async () => {
    const forged = { netWorth: { netWorth: 999_999_999_999 } }
    const res = await POST(post({ data: forged, locale: 'vi' }))

    expect(res.status).toBe(200)
    expect(h.rendered[0].data).toEqual(SERVER_DATA)
    expect(h.rendered[0].data.netWorth.netWorth).toBe(500_000_000)
  })

  it('defaults to the Vietnamese locale when none is sent', async () => {
    const res = await POST(post())

    expect(res.status).toBe(200)
    expect(h.rendered[0].locale).toBe('vi')
  })

  it('passes an allowlisted locale through', async () => {
    await POST(post({ locale: 'en' }))

    expect(h.rendered[0].locale).toBe('en')
  })

  it('rejects a locale outside the allowlist', async () => {
    const res = await POST(post({ locale: '../../etc/passwd' }))

    expect(res.status).toBe(400)
    expect(h.rendered).toEqual([])
    expect(h.overviewCalls).toEqual([])
  })

  it('rejects a non-string locale', async () => {
    expect((await POST(post({ locale: { toString: 'vi' } }))).status).toBe(400)
    expect((await POST(post({ locale: ['vi'] }))).status).toBe(400)
    expect(h.rendered).toEqual([])
  })

  it('rejects a malformed body', async () => {
    const res = await POST(post('{"locale": '))

    expect(res.status).toBe(400)
    expect(h.rendered).toEqual([])
  })

  // Oversized and deeply nested payloads are the DoS half of #594. With the data
  // no longer read from the body, both are refused by the size cap before any
  // parsing or rendering happens.
  it('rejects a full forged dashboard payload as oversized', async () => {
    const forged = {
      data: { ...SERVER_DATA, netWorth: { ...SERVER_DATA.netWorth, netWorth: 999_999_999_999 } },
      locale: 'vi',
    }
    const res = await POST(post(forged))

    expect(res.status).toBe(413)
    expect(h.rendered).toEqual([])
  })

  it('rejects an oversized body with 413 without rendering', async () => {
    const res = await POST(post({ pad: 'x'.repeat(4096) }))

    expect(res.status).toBe(413)
    expect(h.rendered).toEqual([])
    expect(h.overviewCalls).toEqual([])
  })

  it('rejects a deeply nested body without rendering', async () => {
    let nested: unknown = 'leaf'
    for (let i = 0; i < 2000; i++) nested = { n: nested }
    const res = await POST(post(nested))

    expect(res.status).toBe(413)
    expect(h.rendered).toEqual([])
  })

  it('refuses once the per-user render limit is exceeded', async () => {
    h.rateLimit = { data: [{ allowed: false, retry_after_seconds: 42 }], error: null }
    const res = await POST(post({ locale: 'vi' }))

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
    expect(h.overviewCalls).toEqual([])
    expect(h.rendered).toEqual([])
  })

  // Fail closed, exactly like the gold-refresh limiter (#530): if the limit
  // cannot be verified, an expensive render must not run uncapped.
  it('refuses when the rate-limit check is unavailable', async () => {
    h.rateLimit = { data: null, error: { message: 'relation does not exist' } }
    const res = await POST(post({ locale: 'vi' }))

    expect(res.status).toBe(503)
    expect(h.rendered).toEqual([])
  })

  it('checks the rate limit before computing the report data', async () => {
    await POST(post({ locale: 'vi' }))

    expect(h.rpcCalls).toEqual(['check_report_render_rate_limit'])
  })

  it('returns 500 when the report data cannot be computed', async () => {
    h.overview = { ok: false }
    const res = await POST(post({ locale: 'vi' }))

    expect(res.status).toBe(500)
    expect(h.rendered).toEqual([])
  })
})
