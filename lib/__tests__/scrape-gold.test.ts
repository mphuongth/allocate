import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The gold scraper fetched DOJI with a bare `fetch(...).then(r => r.text())`:
// no timeout, no size cap, no status check (#530). A slow upstream could hold a
// serverless function open for as long as it liked, an oversized body was read
// straight into memory, and a 404/500 error page was handed to the price regex —
// which then reported "price row not found", pointing the reader at a layout
// change rather than an outage.
//
// It now goes through the same bounded fetch the NAV scraper uses. The bounds
// themselves are covered in boundedFetch.test.ts; what this file pins is that
// gold actually goes through it and doesn't swallow what it raises.

const h = vi.hoisted(() => ({
  calls: [] as { url: string; init: Record<string, unknown> }[],
  html: '',
  error: null as Error | null,
}))

vi.mock('../boundedFetch', () => ({
  boundedFetchText: async (url: string, init: Record<string, unknown> = {}) => {
    h.calls.push({ url, init })
    if (h.error) throw h.error
    return h.html
  },
}))

const { scrapeGoldPrice } = await import('../scrape-gold')

const page = (price: string) =>
  `<table><tr><td>NHẪN TRÒN 9999</td><td>${price}</td><td>8,700</td></tr></table>`

describe('scrapeGoldPrice', () => {
  beforeEach(() => {
    h.calls = []
    h.html = page('8,500')
    h.error = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parses the ring price and scales it to VND per chi', async () => {
    await expect(scrapeGoldPrice()).resolves.toBe(8_500_000)
  })

  it('handles a larger comma-grouped price', async () => {
    h.html = page('12,345')
    await expect(scrapeGoldPrice()).resolves.toBe(12_345_000)
  })

  // Not asserting a dot-grouped price here: parseVietnameseNumber deliberately
  // reads '8.500' as the float 8.5 when no comma-decimal gives it thousands
  // context — see parseVietnameseNumber.test.ts, which documents that ambiguity.
  // DOJI sends comma groups, so this scraper never hits it.

  // The structural point: gold must not reintroduce a bare fetch.
  it('fetches through the bounded helper', async () => {
    await scrapeGoldPrice()
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].url).toContain('doji.vn')
  })

  it('does not call the global fetch directly', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await scrapeGoldPrice()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('still sends the browser-ish headers the site expects', async () => {
    await scrapeGoldPrice()
    const headers = h.calls[0].init.headers as Record<string, string>
    expect(headers['User-Agent']).toBeTruthy()
    expect(headers['Accept-Language']).toContain('vi')
  })

  // A timeout, an oversized body and a non-2xx all surface as a throw from the
  // bounded fetch. The scraper must let them through — the refresh routes turn a
  // throw into a 502, whereas swallowing it would mean writing a junk price.
  it('propagates an upstream failure instead of swallowing it', async () => {
    h.error = new Error('Upstream responded 503 for giavang.doji.vn')
    await expect(scrapeGoldPrice()).rejects.toThrow(/503/)
  })

  it('propagates a timeout', async () => {
    h.error = new Error('The operation was aborted due to timeout')
    await expect(scrapeGoldPrice()).rejects.toThrow(/timeout/i)
  })

  it('propagates an oversized response', async () => {
    h.error = new Error('Response exceeded 2097152 bytes')
    await expect(scrapeGoldPrice()).rejects.toThrow(/exceeded/i)
  })

  it('throws when the price row is absent', async () => {
    h.html = '<html>maintenance</html>'
    await expect(scrapeGoldPrice()).rejects.toThrow(/not found/i)
  })

  it('throws rather than returning a non-positive price', async () => {
    h.html = page('0')
    await expect(scrapeGoldPrice()).rejects.toThrow(/invalid price/i)
  })
})
