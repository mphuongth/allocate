import { describe, it, expect, vi, beforeEach } from 'vitest'
import { normalizeFundCode, buildNavIndex, lookupFundNav, FMARKET_FILTER_URL } from '../fmarket-nav'

const h = vi.hoisted(() => ({
  calls: [] as { url: string; init: Record<string, unknown> }[],
  body: '',
  error: null as Error | null,
  gate: null as Promise<void> | null,
}))

vi.mock('../boundedFetch', () => ({
  boundedFetchText: async (url: string, init: Record<string, unknown> = {}) => {
    h.calls.push({ url, init })
    // `gate` lets a test hold the response open, which is the only way to have
    // more than one caller in flight at once.
    if (h.gate) await h.gate
    if (h.error) throw h.error
    return h.body
  },
}))

const { fetchFmarketNavIndex, isFundCodePriceable, clearFmarketNavCache } = await import('../fmarket-nav')

// A slice of the real feed, values as returned on 2026-08-07 and cross-checked
// against each provider's own site.
const ROWS = [
  { shortName: 'VCBF-BCF', code: 'VCBFBCF', nav: 40789.29 },
  { shortName: 'VCBF-FIF', code: 'VCBFFIF', nav: 16024.72 },
  { shortName: 'DCDS', code: 'DCDS', nav: 93915.08 },
  { shortName: 'SSISCA', code: 'SSISCA', nav: 41110.8 },
  { shortName: 'VESAF', code: 'VESAF', nav: 31214.47 },
  { shortName: 'SSI-PDF', code: 'SSIPDF', nav: 0 },
]

const feed = (rows: unknown) => JSON.stringify({ status: 200, data: { rows } })

describe('normalizeFundCode', () => {
  it('collapses the ways one fund code gets written', () => {
    for (const raw of ['VCBF-BCF', 'VCBFBCF', 'vcbf bcf', ' vcbf-bcf ', 'VCBF.BCF']) {
      expect(normalizeFundCode(raw)).toBe('VCBFBCF')
    }
  })
})

describe('buildNavIndex', () => {
  it('indexes each fund under both its hyphenated and compact identifier', () => {
    const index = buildNavIndex(ROWS)
    expect(index.get('VCBFBCF')).toBe(40789.29)
    expect(index.get('DCDS')).toBe(93915.08)
  })

  // A fund that has not priced yet reports nav 0. Indexing it would let a
  // refresh overwrite a good NAV with a zero the DB then rejects.
  it('skips unpriced funds rather than indexing a zero NAV', () => {
    const index = buildNavIndex(ROWS)
    expect(index.has('SSIPDF')).toBe(false)
  })

  it('rejects a payload that is not a list', () => {
    expect(() => buildNavIndex({ rows: [] })).toThrow(/not an array/i)
  })

  // An empty index would otherwise make every fund report "not listed",
  // blaming the user's fund codes for what is an upstream outage.
  it('rejects a list with nothing priced in it', () => {
    expect(() => buildNavIndex([{ shortName: 'X', code: 'X', nav: 0 }])).toThrow(/no priced funds/i)
  })
})

describe('lookupFundNav', () => {
  const index = buildNavIndex(ROWS)

  it('resolves a code however it was written', () => {
    for (const stored of ['VCBF-BCF', 'VCBFBCF', 'vcbf-bcf']) {
      expect(lookupFundNav(index, stored)).toBe(40789.29)
    }
  })

  it('resolves a bare suffix when exactly one fund can match', () => {
    expect(lookupFundNav(index, 'BCF')).toBe(40789.29)
  })

  // The VCBF scraper's actual bug, at the new layer: when the identity is
  // ambiguous it must fail for that fund, never fall back to a plausible
  // neighbour and store a wrong price under a successful sync.
  it('refuses an ambiguous suffix instead of guessing', () => {
    const ambiguous = buildNavIndex([
      { shortName: 'VCBF-BCF', code: 'VCBFBCF', nav: 40789.29 },
      { shortName: 'ABC-BCF', code: 'ABCBCF', nav: 111.11 },
    ])
    expect(lookupFundNav(ambiguous, 'BCF')).toBeNull()
  })

  it('returns null for an unknown or empty code', () => {
    expect(lookupFundNav(index, 'NOSUCHFUND')).toBeNull()
    expect(lookupFundNav(index, '   ')).toBeNull()
  })

  // A missing/malformed code on one row must cost that row its NAV, not throw
  // and abandon the refresh for every other fund in the same run.
  it('degrades a non-string code to no match instead of throwing', () => {
    expect(normalizeFundCode(undefined)).toBe('')
    expect(lookupFundNav(index, undefined)).toBeNull()
    expect(lookupFundNav(index, null)).toBeNull()
  })
})

describe('fetchFmarketNavIndex', () => {
  beforeEach(() => {
    h.calls = []
    h.body = feed(ROWS)
    h.error = null
    h.gate = null
    clearFmarketNavCache()
  })

  it('returns an index built from the feed', async () => {
    const index = await fetchFmarketNavIndex()
    expect(index.get('VESAF')).toBe(31214.47)
    expect(index.get('SSISCA')).toBe(41110.8)
  })

  it('posts the filter body through the bounded helper', async () => {
    await fetchFmarketNavIndex()
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].url).toBe(FMARKET_FILTER_URL)
    expect(h.calls[0].init.method).toBe('POST')
    expect(JSON.parse(h.calls[0].init.body as string).pageSize).toBeGreaterThan(100)
  })

  it('does not call the global fetch directly', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await fetchFmarketNavIndex()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('propagates an upstream failure instead of swallowing it', async () => {
    h.error = new Error('Upstream responded 503 for api.fmarket.vn')
    await expect(fetchFmarketNavIndex()).rejects.toThrow(/503/)
  })

  it('reports a non-JSON body distinctly', async () => {
    h.body = '<html>maintenance</html>'
    await expect(fetchFmarketNavIndex()).rejects.toThrow(/not JSON/i)
  })

  it('reports an unexpected envelope shape', async () => {
    h.body = JSON.stringify({ status: 200 })
    await expect(fetchFmarketNavIndex()).rejects.toThrow(/not an array/i)
  })
})

describe('isFundCodePriceable — write-time check', () => {
  beforeEach(() => {
    h.calls = []
    h.body = feed(ROWS)
    h.error = null
    h.gate = null
    clearFmarketNavCache()
  })

  it('accepts a code the feed can price, in any spelling', async () => {
    await expect(isFundCodePriceable('VCBF-BCF')).resolves.toBe(true)
    await expect(isFundCodePriceable('vcbfbcf')).resolves.toBe(true)
  })

  it('rejects a code nothing upstream matches', async () => {
    await expect(isFundCodePriceable('MYSTERY')).resolves.toBe(false)
  })

  it('rejects an empty code without going upstream at all', async () => {
    await expect(isFundCodePriceable('   ')).resolves.toBe(false)
    expect(h.calls).toHaveLength(0)
  })

  // Fail OPEN, unlike the refresh routes. A feed outage says nothing about the
  // code, and must not stand between someone and editing their own fund.
  it('returns null when the feed cannot be reached, rather than false', async () => {
    h.error = new Error('Upstream responded 503 for api.fmarket.vn')
    await expect(isFundCodePriceable('VCBF-BCF')).resolves.toBeNull()
  })

  it('returns null when the feed is reachable but unusable', async () => {
    h.body = '<html>maintenance</html>'
    await expect(isFundCodePriceable('VCBF-BCF')).resolves.toBeNull()
  })
})

// Codex flagged the write-time check as an unbounded outbound request per save
// (PR #644). The durable rate limits stay where they were — they bound a
// deliberate refresh — but a burst of saves must not each pull the ~270 KB
// product list, so a warm instance reuses the last good index briefly.
describe('fetchFmarketNavIndex — short-lived reuse', () => {
  beforeEach(() => {
    h.calls = []
    h.body = feed(ROWS)
    h.error = null
    h.gate = null
    clearFmarketNavCache()
  })

  it('serves repeat callers from one upstream request', async () => {
    const a = await fetchFmarketNavIndex(1_000)
    const b = await fetchFmarketNavIndex(1_500)

    expect(h.calls).toHaveLength(1)
    expect(b.get('DCDS')).toBe(a.get('DCDS'))
  })

  it('refetches once the window has passed', async () => {
    await fetchFmarketNavIndex(1_000)
    await fetchFmarketNavIndex(1_000 + 60_001)

    expect(h.calls).toHaveLength(2)
  })

  // Caching a throw would turn one bad response into a minute of failures for
  // every caller, including the daily cron.
  it('does not cache a failure', async () => {
    h.error = new Error('Upstream responded 503 for api.fmarket.vn')
    await expect(fetchFmarketNavIndex(1_000)).rejects.toThrow(/503/)

    h.error = null
    await expect(fetchFmarketNavIndex(1_100)).resolves.toBeInstanceOf(Map)
    expect(h.calls).toHaveLength(2)
  })

  it('does not cache an unusable payload', async () => {
    h.body = feed([])
    await expect(fetchFmarketNavIndex(1_000)).rejects.toThrow(/no priced funds/i)

    h.body = feed(ROWS)
    await expect(fetchFmarketNavIndex(1_100)).resolves.toBeInstanceOf(Map)
    expect(h.calls).toHaveLength(2)
  })
})

// Codex, second pass on #644: caching only the resolved index still let a burst
// stampede — every concurrent caller misses the cache before the first response
// lands and starts its own full-feed fetch. The outbound semaphore paces those
// at 6 at a time; it does not prevent them. The in-flight promise is now shared.
describe('fetchFmarketNavIndex — concurrent callers share one request', () => {
  beforeEach(() => {
    h.calls = []
    h.body = feed(ROWS)
    h.error = null
    h.gate = null
    clearFmarketNavCache()
  })

  it('collapses a burst of cache misses into a single upstream fetch', async () => {
    let open: () => void = () => {}
    h.gate = new Promise<void>((r) => { open = r })

    // All five start before any response can land.
    const bursting = Array.from({ length: 5 }, () => fetchFmarketNavIndex(1_000))
    open()
    const indexes = await Promise.all(bursting)

    expect(h.calls).toHaveLength(1)
    for (const index of indexes) expect(index.get('DCDS')).toBe(93915.08)
  })

  it('gives every joiner the same failure and lets the next caller retry', async () => {
    let open: () => void = () => {}
    h.gate = new Promise<void>((r) => { open = r })
    h.error = new Error('Upstream responded 503 for api.fmarket.vn')

    const bursting = Array.from({ length: 3 }, () => fetchFmarketNavIndex(1_000))
    open()
    const settled = await Promise.allSettled(bursting)

    expect(h.calls).toHaveLength(1)
    for (const r of settled) expect(r.status).toBe('rejected')

    // A failed flight must not be inherited by whoever comes next.
    h.gate = null
    h.error = null
    await expect(fetchFmarketNavIndex(1_100)).resolves.toBeInstanceOf(Map)
    expect(h.calls).toHaveLength(2)
  })

  it('serves callers arriving after the flight from the cache, not a new flight', async () => {
    await fetchFmarketNavIndex(1_000)
    await Promise.all([fetchFmarketNavIndex(1_100), fetchFmarketNavIndex(1_200)])

    expect(h.calls).toHaveLength(1)
  })
})
