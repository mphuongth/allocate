import { describe, it, expect, beforeEach, vi } from 'vitest'

// The split both refresh paths depend on: an open-ended fund is priced from the
// Fmarket feed, an ETF from the exchange, and neither source's bad day is
// allowed to become the other's.
const h = vi.hoisted(() => ({
  navCalls: 0,
  navError: null as Error | null,
  etfCalls: [] as string[],
  etfPrices: {} as Record<string, number | null | Error>,
}))

vi.mock('../fmarket-nav', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../fmarket-nav')>()
  return {
    ...actual,
    fetchFmarketNavIndex: async () => {
      h.navCalls++
      if (h.navError) throw h.navError
      return new Map([['DCDS', 93_915.08], ['VESAF', 31_214.47]])
    },
  }
})

vi.mock('../hose-price', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hose-price')>()
  return {
    ...actual,
    fetchEtfMarketPrice: async (symbol: unknown) => {
      const key = actual.normalizeSymbol(symbol)
      h.etfCalls.push(key)
      const price = h.etfPrices[key]
      if (price instanceof Error) throw price
      return price ?? null
    },
  }
})

const { priceAutoSyncFunds } = await import('../fundPricing')

beforeEach(() => {
  h.navCalls = 0
  h.navError = null
  h.etfCalls = []
  h.etfPrices = { FUEVFVND: 34_380, E1VFVN30: 35_610 }
})

const priced = (out: { ok: boolean } | undefined) =>
  out && out.ok ? (out as { ok: true; price: number }).price : null
const failure = (out: { ok: boolean } | undefined) =>
  out && !out.ok ? (out as { ok: false; error: string }).error : null

describe('priceAutoSyncFunds', () => {
  it('prices each fund from the source that actually lists it', async () => {
    const dcds = { code: 'DCDS', fund_type: 'equity' }
    const etf = { code: 'FUEVFVND', fund_type: 'etf' }

    const out = await priceAutoSyncFunds([dcds, etf])

    expect(priced(out.get(dcds))).toBe(93_915.08)
    expect(priced(out.get(etf))).toBe(34_380)
    expect(h.etfCalls).toEqual(['FUEVFVND'])
  })

  it('asks Fmarket once however many open-ended funds there are', async () => {
    await priceAutoSyncFunds([
      { code: 'DCDS', fund_type: 'equity' },
      { code: 'VESAF', fund_type: 'balanced' },
      { code: 'DCDS', fund_type: 'debt' },
    ])
    expect(h.navCalls).toBe(1)
  })

  it('does not call Fmarket at all for a portfolio of only ETFs', async () => {
    // One user holding nothing but ETFs must not drag a 270 KB product list down
    // on every refresh.
    await priceAutoSyncFunds([{ code: 'FUEVFVND', fund_type: 'etf' }])
    expect(h.navCalls).toBe(0)
  })

  it('asks the exchange once per distinct ticker', async () => {
    // Two users hold the same ETF; the nightly cron sees both rows.
    await priceAutoSyncFunds([
      { code: 'FUEVFVND', fund_type: 'etf' },
      { code: 'fue-vfvnd', fund_type: 'etf' },
    ])
    expect(h.etfCalls).toEqual(['FUEVFVND'])
  })

  it('keeps one source’s outage out of the other’s results', async () => {
    // The regression this module exists to prevent. The cron used to give up on
    // every fund the moment the single upstream request failed — with two
    // sources, that would have let Fmarket being down freeze ETF prices too.
    h.navError = new Error('Fmarket: response was not JSON')
    const dcds = { code: 'DCDS', fund_type: 'equity' }
    const etf = { code: 'FUEVFVND', fund_type: 'etf' }

    const out = await priceAutoSyncFunds([dcds, etf])

    expect(failure(out.get(dcds))).toContain('Fmarket')
    expect(priced(out.get(etf))).toBe(34_380)
  })

  it('keeps one ticker’s failure off the other tickers', async () => {
    h.etfPrices.BROKEN = new Error('Upstream responded 502 for dchart-api.vndirect.com.vn')
    const broken = { code: 'BROKEN', fund_type: 'etf' }
    const fine = { code: 'E1VFVN30', fund_type: 'etf' }

    const out = await priceAutoSyncFunds([broken, fine])

    expect(failure(out.get(broken))).toContain('502')
    expect(priced(out.get(fine))).toBe(35_610)
  })

  it('names the code when a source does not list it', async () => {
    const unlisted = { code: 'NOSUCH', fund_type: 'equity' }
    const unlistedEtf = { code: 'NOTATICKER', fund_type: 'etf' }

    const out = await priceAutoSyncFunds([unlisted, unlistedEtf])

    expect(failure(out.get(unlisted))).toContain('NOSUCH')
    expect(failure(out.get(unlistedEtf))).toContain('NOTATICKER')
  })

  it('treats a fund with no type as an open-ended fund', async () => {
    // Only 'etf' routes to the exchange. A legacy row with a null type, or a type
    // added later, must keep pricing the way it priced yesterday rather than
    // start asking HOSE about a code HOSE never heard of.
    const legacy = { code: 'DCDS', fund_type: null }
    const out = await priceAutoSyncFunds([legacy])
    expect(priced(out.get(legacy))).toBe(93_915.08)
    expect(h.etfCalls).toEqual([])
  })

  it('has nothing to ask about an empty list', async () => {
    expect((await priceAutoSyncFunds([])).size).toBe(0)
    expect(h.navCalls).toBe(0)
    expect(h.etfCalls).toEqual([])
  })
})
