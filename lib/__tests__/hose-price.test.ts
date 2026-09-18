import { describe, it, expect, beforeEach, vi } from 'vitest'

// The ETF price source, driven the way the routes drive it. `boundedFetch` is
// mocked rather than `fetch` so the tests state what the module asks for — one
// URL per symbol — instead of re-testing the timeout/byte-cap helper.
const h = vi.hoisted(() => ({
  urls: [] as string[],
  bodies: {} as Record<string, string | Error>,
  gate: null as Promise<void> | null,
}))

vi.mock('../boundedFetch', () => ({
  boundedFetchText: async (url: string) => {
    h.urls.push(url)
    // Holds a response open so two callers can be in flight at once.
    if (h.gate) await h.gate
    const symbol = new URL(url).searchParams.get('symbol') ?? ''
    const body = h.bodies[symbol]
    if (body === undefined) throw new Error(`test asked for an unexpected symbol: ${symbol}`)
    if (body instanceof Error) throw body
    return body
  },
}))

const { normalizeSymbol, fetchEtfMarketPrice, isEtfSymbolPriceable, clearEtfPriceCache } =
  await import('../hose-price')

const NOW = Date.UTC(2026, 8, 18, 7, 0, 0) // 2026-09-18, a Friday afternoon in VN
const DAY = 86_400_000

/**
 * A slice of the real feed. The closes are what VNDirect returned on
 * 2026-09-18 — in THOUSANDS of đồng, which is the whole reason this module
 * exists rather than the value being read straight off the JSON.
 */
const bars = (closes: number[], lastAt: number = NOW) =>
  JSON.stringify({
    t: closes.map((_, i) => Math.floor((lastAt - (closes.length - 1 - i) * DAY) / 1000)),
    o: closes,
    h: closes,
    l: closes,
    c: closes,
    v: closes.map(() => 1_000_000),
    s: 'ok',
  })

beforeEach(() => {
  h.urls = []
  h.bodies = {}
  h.gate = null
  clearEtfPriceCache()
})

describe('normalizeSymbol', () => {
  it('collapses the ways a ticker gets typed', () => {
    for (const raw of ['FUEVFVND', ' fuevfvnd ', 'fue-vfvnd', 'FUE VFVND']) {
      expect(normalizeSymbol(raw)).toBe('FUEVFVND')
    }
  })

  it('is empty for anything that is not a ticker', () => {
    expect(normalizeSymbol(null)).toBe('')
    expect(normalizeSymbol(42)).toBe('')
    expect(normalizeSymbol('---')).toBe('')
  })
})

describe('fetchEtfMarketPrice', () => {
  it('returns the price in đồng, not in thousands', async () => {
    h.bodies.FUEVFVND = bars([34.38])
    // 34.38 on the wire is 34,380 ₫ per certificate. Getting this wrong is not a
    // visible bug — it is a portfolio reported 1000x off with nothing to show for
    // it — so the factor is pinned here and nowhere else.
    expect(await fetchEtfMarketPrice('FUEVFVND', NOW)).toBe(34_380)
  })

  it('takes the last session, not the first', async () => {
    h.bodies.E1VFVN30 = bars([34.9, 35.2, 35.61])
    expect(await fetchEtfMarketPrice('E1VFVN30', NOW)).toBe(35_610)
  })

  it('keeps the đồng a close carries below the thousand', async () => {
    h.bodies.FUESSVFL = bars([29.385])
    expect(await fetchEtfMarketPrice('FUESSVFL', NOW)).toBe(29_385)
  })

  it('asks for a window long enough to survive a Tết break', async () => {
    h.bodies.FUEVFVND = bars([34.38])
    await fetchEtfMarketPrice('FUEVFVND', NOW)

    const params = new URL(h.urls[0]).searchParams
    const to = Number(params.get('to'))
    const from = Number(params.get('from'))
    expect(params.get('symbol')).toBe('FUEVFVND')
    expect(params.get('resolution')).toBe('D')
    expect(to).toBe(Math.floor(NOW / 1000))
    // The exchange shuts for up to nine days at Tết, and asking for a window
    // shorter than that returns an empty series — which this module cannot tell
    // apart from a delisting.
    expect((to - from) / 86_400).toBeGreaterThanOrEqual(30)
  })

  it('refuses a ticker the exchange does not list', async () => {
    // What the feed really does with an unknown symbol, checked against it: HTTP
    // 200 and a ZERO-BYTE body. Not an error status, not a documented `no_data`
    // marker — so `boundedFetchText`'s status check waves it through and the
    // emptiness is this module's to notice.
    h.bodies.NOTATICKER = ''
    expect(await fetchEtfMarketPrice('NOTATICKER', NOW)).toBeNull()

    // The UDF convention the endpoint follows spells the same thing this way,
    // and costs one comparison to honour.
    h.bodies.ALSOGONE = JSON.stringify({ s: 'no_data' })
    expect(await fetchEtfMarketPrice('ALSOGONE', NOW)).toBeNull()
  })

  it('refuses an empty series', async () => {
    h.bodies.FUEVFVND = JSON.stringify({ t: [], c: [], s: 'ok' })
    expect(await fetchEtfMarketPrice('FUEVFVND', NOW)).toBeNull()
  })

  it('refuses a body that is not the feed', async () => {
    h.bodies.FUEVFVND = '<html>rate limited</html>'
    expect(await fetchEtfMarketPrice('FUEVFVND', NOW)).toBeNull()
  })

  it('refuses a series whose shape is not the feed’s', async () => {
    // `s: "ok"` is the feed's own word for "this answer is good". It is not
    // proof: an upstream that reshapes the payload would otherwise have whatever
    // sits in the last slot multiplied by a thousand and written as a price.
    h.bodies.NOTARRAY = JSON.stringify({ s: 'ok', t: 'nope', c: [34.38] })
    h.bodies.MISMATCHED = JSON.stringify({ s: 'ok', t: [1_789_689_600, 1_789_776_000], c: [34.38] })
    h.bodies.TEXTPRICE = JSON.stringify({ s: 'ok', t: [1_789_689_600], c: ['34.38'] })
    h.bodies.NOTIME = JSON.stringify({ s: 'ok', t: [null], c: [34.38] })

    for (const symbol of ['NOTARRAY', 'MISMATCHED', 'TEXTPRICE', 'NOTIME']) {
      expect(await fetchEtfMarketPrice(symbol, NOW), symbol).toBeNull()
    }
  })

  it('refuses a close outside the band a listed price can occupy', async () => {
    // The guard is not a judgement about the market — it is what catches the
    // upstream quietly switching units. A feed that starts sending absolute
    // đồng (34380) would otherwise be multiplied again into 34 million.
    h.bodies.TOOBIG = bars([34_380])
    h.bodies.TOOSMALL = bars([0.0004])
    h.bodies.ZERO = bars([0])
    expect(await fetchEtfMarketPrice('TOOBIG', NOW)).toBeNull()
    expect(await fetchEtfMarketPrice('TOOSMALL', NOW)).toBeNull()
    expect(await fetchEtfMarketPrice('ZERO', NOW)).toBeNull()
  })

  it('refuses a series that stopped moving', async () => {
    // A halted or delisted ticker keeps answering with its final close forever.
    // Storing it would refresh `updated_at` every night, which is exactly what
    // the dashboard's stale-price banner reads — so the lie would be invisible.
    h.bodies.GONE = bars([31.2], NOW - 30 * DAY)
    expect(await fetchEtfMarketPrice('GONE', NOW)).toBeNull()

    // A weekend, or a short holiday, is not staleness.
    h.bodies.FUEVFVND = bars([34.38], NOW - 3 * DAY)
    expect(await fetchEtfMarketPrice('FUEVFVND', NOW)).toBe(34_380)
  })

  it('asks the exchange once per symbol within the TTL', async () => {
    h.bodies.FUEVFVND = bars([34.38])
    await fetchEtfMarketPrice('FUEVFVND', NOW)
    await fetchEtfMarketPrice('fue-vfvnd', NOW + 1_000)
    expect(h.urls).toHaveLength(1)
  })

  it('collapses concurrent callers for one symbol into one request', async () => {
    h.bodies.FUEVFVND = bars([34.38])
    let release: () => void = () => {}
    h.gate = new Promise<void>((r) => { release = r })

    const both = Promise.all([
      fetchEtfMarketPrice('FUEVFVND', NOW),
      fetchEtfMarketPrice('FUEVFVND', NOW),
    ])
    release()
    expect(await both).toEqual([34_380, 34_380])
    expect(h.urls).toHaveLength(1)
  })

  it('never answers one symbol with another symbol’s price', async () => {
    // The failure the retired VCBF scraper shipped: a near-miss match stored a
    // neighbour's price and nothing looked wrong.
    h.bodies.FUEVFVND = bars([34.38])
    h.bodies.E1VFVN30 = bars([35.61])
    expect(await fetchEtfMarketPrice('FUEVFVND', NOW)).toBe(34_380)
    expect(await fetchEtfMarketPrice('E1VFVN30', NOW)).toBe(35_610)
    expect(h.urls).toHaveLength(2)
  })

  it('does not cache a failure', async () => {
    h.bodies.FUEVFVND = new Error('Upstream responded 503 for dchart-api.vndirect.com.vn')
    await expect(fetchEtfMarketPrice('FUEVFVND', NOW)).rejects.toThrow('503')

    h.bodies.FUEVFVND = bars([34.38])
    expect(await fetchEtfMarketPrice('FUEVFVND', NOW)).toBe(34_380)
  })

  it('has nothing to ask about an empty symbol', async () => {
    expect(await fetchEtfMarketPrice('', NOW)).toBeNull()
    expect(h.urls).toHaveLength(0)
  })
})

describe('isEtfSymbolPriceable', () => {
  it('is true for a listed ticker and false for an invented one', async () => {
    h.bodies.FUEVFVND = bars([34.38])
    h.bodies.NOTATICKER = JSON.stringify({ s: 'no_data' })
    expect(await isEtfSymbolPriceable('FUEVFVND')).toBe(true)
    expect(await isEtfSymbolPriceable('NOTATICKER')).toBe(false)
    expect(await isEtfSymbolPriceable('')).toBe(false)
  })

  it('is null when the exchange cannot be reached', async () => {
    // Fails OPEN, the opposite of the refresh path. The feed being down says
    // nothing about the ticker, and must never stop someone saving their own
    // fund — while an unverifiable price is a price not worth storing.
    h.bodies.FUEVFVND = new Error('Upstream responded 502 for dchart-api.vndirect.com.vn')
    expect(await isEtfSymbolPriceable('FUEVFVND')).toBeNull()
  })
})
