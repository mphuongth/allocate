import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'node:crypto'
import { DOJI_PRICE_TABLE_URL, DOJI_PAYLOAD_KEY_HEX } from '../scrape-gold'

// DOJI retired the scrapeable HTML board: giavang.doji.vn now 301s to
// banggia.doji.vn, an Angular SPA whose markup carries no prices at all. The old
// regex over "NHẪN TRÒN" could therefore never match again — every refresh
// returned "price row not found", which reads as a layout change but was a dead
// source.
//
// The SPA reads the board from an unauthenticated JSON endpoint whose payload is
// AES-256-CBC with a key shipped in the public bundle. That is obfuscation, not
// authentication, so this decrypts it the same way the browser does. What the
// tests below pin is the envelope→decrypt→select→scale chain, and that each way
// it can break reports *which* link broke — a rotated key must not read as a
// missing product.

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

const { scrapeGoldPrice } = await import('../scrape-gold')

type Row = { materialCode: string; materialName: string; priceDojiBuyIn: number | null; priceDojiSellOut?: number | null }

// Encrypts exactly the way the endpoint does, so the fixture exercises the real
// decrypt path rather than a stub of it: random IV prepended to the ciphertext,
// the whole thing base64'd into a { status, data } envelope.
function envelope(rows: Row[], key: string = DOJI_PAYLOAD_KEY_HEX): string {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'hex'), iv)
  const ct = Buffer.concat([cipher.update(JSON.stringify(rows), 'utf8'), cipher.final()])
  return JSON.stringify({ status: true, data: Buffer.concat([iv, ct]).toString('base64') })
}

// The real board, trimmed to the rows that matter.
const BOARD: Row[] = [
  { materialCode: '01', materialName: 'VÀNG MIẾNG SJC', priceDojiBuyIn: 13920, priceDojiSellOut: 14220 },
  { materialCode: '02', materialName: 'KIM TT/AVPL', priceDojiBuyIn: 14000, priceDojiSellOut: 14400 },
  { materialCode: '03', materialName: 'NHẪN TRÒN 9999 HƯNG THỊNH VƯỢNG', priceDojiBuyIn: 14000, priceDojiSellOut: 14400 },
  { materialCode: '04', materialName: 'VÀNG NGUYÊN LIỆU 9999', priceDojiBuyIn: 13400, priceDojiSellOut: 13600 },
]

describe('scrapeGoldPrice', () => {
  beforeEach(() => {
    h.calls = []
    h.body = envelope(BOARD)
    h.error = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('decrypts the board and scales the ring price to VND per chi', async () => {
    await expect(scrapeGoldPrice()).resolves.toBe(14_000_000)
  })

  // The buy-in column, not the sell-out one. The retired HTML scraper read the
  // first <td> after the label — DOJI's "Giá mua" — and this is the same number,
  // so the switch of source must not silently re-price every holding 2.9% higher.
  it('reads the buy-in price, not the sell-out price', async () => {
    await expect(scrapeGoldPrice()).resolves.not.toBe(14_400_000)
  })

  // The ring is picked by product name, not by its position or its materialCode:
  // the board is an ordered list DOJI renumbers, and picking row 3 by index would
  // silently start valuing gold bars the day they insert a row above it.
  it('selects the ring by name even when the board is reordered and renumbered', async () => {
    h.body = envelope([
      { materialCode: '01', materialName: 'VÀNG NGUYÊN LIỆU 9999', priceDojiBuyIn: 13400 },
      { materialCode: '02', materialName: 'NHẪN TRÒN 9999 HƯNG THỊNH VƯỢNG', priceDojiBuyIn: 14100 },
      { materialCode: '03', materialName: 'VÀNG MIẾNG SJC', priceDojiBuyIn: 13920 },
    ])
    await expect(scrapeGoldPrice()).resolves.toBe(14_100_000)
  })

  it('fetches the price table through the bounded helper', async () => {
    await scrapeGoldPrice()
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].url).toBe(DOJI_PRICE_TABLE_URL)
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
  // throw into a 502, whereas swallowing one would mean writing a junk price.
  it('propagates an upstream failure instead of swallowing it', async () => {
    h.error = new Error('Upstream responded 503 for banggia.doji.vn')
    await expect(scrapeGoldPrice()).rejects.toThrow(/503/)
  })

  it('propagates a timeout', async () => {
    h.error = new Error('The operation was aborted due to timeout')
    await expect(scrapeGoldPrice()).rejects.toThrow(/timeout/i)
  })

  // The three ways this source can rot, each of which must name itself. A
  // rotated key reported as "ring not found" would send the next reader hunting
  // for a discontinued product instead of re-reading the bundle.
  it('reports a rotated payload key as a decrypt failure', async () => {
    h.body = envelope(BOARD, 'f'.repeat(64))
    await expect(scrapeGoldPrice()).rejects.toThrow(/decrypt/i)
  })

  it('reports an unexpected envelope shape distinctly', async () => {
    h.body = JSON.stringify({ status: false, data: null })
    await expect(scrapeGoldPrice()).rejects.toThrow(/payload/i)
  })

  it('reports a non-JSON body distinctly', async () => {
    h.body = '<html>maintenance</html>'
    await expect(scrapeGoldPrice()).rejects.toThrow(/payload/i)
  })

  it('throws when the ring is absent from the board', async () => {
    h.body = envelope([{ materialCode: '01', materialName: 'VÀNG MIẾNG SJC', priceDojiBuyIn: 13920 }])
    await expect(scrapeGoldPrice()).rejects.toThrow(/not found/i)
  })

  it('throws rather than returning a non-positive price', async () => {
    h.body = envelope([{ materialCode: '03', materialName: 'NHẪN TRÒN 9999', priceDojiBuyIn: 0 }])
    await expect(scrapeGoldPrice()).rejects.toThrow(/invalid price/i)
  })

  it('throws rather than returning a null price', async () => {
    h.body = envelope([{ materialCode: '03', materialName: 'NHẪN TRÒN 9999', priceDojiBuyIn: null }])
    await expect(scrapeGoldPrice()).rejects.toThrow(/invalid price/i)
  })
})
