import crypto from 'node:crypto'
import { boundedFetchText } from './boundedFetch'

// DOJI's public price board. The old source (giavang.doji.vn, an HTML table)
// was retired: it 301s to banggia.doji.vn, an Angular SPA that renders the board
// client-side, so no amount of regex over the delivered markup can find a price.
//
// This is the endpoint that SPA reads. It needs no authentication — the same
// board every visitor sees — but the payload is AES-256-CBC encrypted with a key
// hardcoded in the public JS bundle. That is obfuscation of a public feed, not
// authentication of a private one, so decrypting it here reads exactly what the
// browser reads and nothing more.
//
// The risk this carries is a key rotation on DOJI's next build. `decryptPayload`
// therefore fails with its own message, so a rotated key is never mistaken for a
// discontinued product — re-read `_k` from the bundle at banggia.doji.vn and
// update the constant below.
export const DOJI_PRICE_TABLE_URL = 'https://banggia.doji.vn/api/TablePrice/GetTablePrice'
export const DOJI_PAYLOAD_KEY_HEX =
  '7a4b8c3d1e9f2a5b6c0d4e8f3a7b1c5d9e2f6a0b4c8d3e7f1a5b9c2d6e0f4a8b'

// The product this app values: DOJI's plain 9999 gold ring, the same row the
// retired scraper matched on. Matched by name rather than by materialCode or
// position — the board is an ordered, renumbered list, so an index or a code
// would quietly start reporting gold bars the day DOJI inserts a row.
const RING_NAME_PATTERN = /NHẪN TRÒN/i

type PriceRow = {
  materialCode?: string
  materialName?: string
  priceDojiBuyIn?: number | null
}

function decryptPayload(base64: string): unknown {
  // IV is prepended to the ciphertext, both inside one base64 blob.
  const blob = Buffer.from(base64, 'base64')
  if (blob.length <= 16) throw new Error('Doji: price payload too short to decrypt')
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      Buffer.from(DOJI_PAYLOAD_KEY_HEX, 'hex'),
      blob.subarray(0, 16),
    )
    const plain = Buffer.concat([decipher.update(blob.subarray(16)), decipher.final()])
    return JSON.parse(plain.toString('utf8'))
  } catch {
    throw new Error('Doji: failed to decrypt the price payload — the bundle key has likely rotated')
  }
}

// Failures are deliberately left to propagate: both refresh routes turn a throw
// into a 502, whereas swallowing one would store a junk price.
export async function scrapeGoldPrice(): Promise<number> {
  const body = await boundedFetchText(DOJI_PRICE_TABLE_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'vi-VN,vi;q=0.9',
      Accept: 'application/json, text/plain, */*',
      Referer: 'https://banggia.doji.vn/gold-price',
    },
  })

  let encrypted: unknown
  try {
    encrypted = (JSON.parse(body) as { data?: unknown }).data
  } catch {
    throw new Error('Doji: price payload was not JSON')
  }
  if (typeof encrypted !== 'string' || encrypted === '') {
    throw new Error('Doji: price payload missing its data field')
  }

  const rows = decryptPayload(encrypted)
  if (!Array.isArray(rows)) throw new Error('Doji: decrypted price payload was not a list of rows')

  const ring = (rows as PriceRow[]).find((r) => RING_NAME_PATTERN.test(r?.materialName ?? ''))
  if (!ring) throw new Error('Doji: NHẪN TRÒN price row not found')

  // Buy-in, not sell-out: the price DOJI pays for the ring is what the holding
  // is worth, and it is the same column the retired HTML scraper read.
  const raw = ring.priceDojiBuyIn
  if (typeof raw !== 'number' || isNaN(raw) || raw <= 0) throw new Error('Doji: invalid price value')

  // The board quotes thousands of VND per chi.
  return raw * 1000
}
