import { describe, it, expect, vi, beforeEach } from 'vitest'
import { normalizeFundCode, buildNavIndex, lookupFundNav, FMARKET_FILTER_URL } from '../fmarket-nav'

const h = vi.hoisted(() => ({
  calls: [] as { url: string; init: Record<string, unknown> }[],
  body: '',
  error: null as Error | null,
}))

vi.mock('../boundedFetch', () => ({
  boundedFetchText: async (url: string, init: Record<string, unknown> = {}) => {
    h.calls.push({ url, init })
    if (h.error) throw h.error
    return h.body
  },
}))

const { fetchFmarketNavIndex } = await import('../fmarket-nav')

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
