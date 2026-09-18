import { boundedFetchText } from './boundedFetch'

// Where an ETF's price comes from.
//
// An open-ended fund is priced by its manager and published through Fmarket
// (lib/fmarket-nav.ts). An ETF is not: it is matched on HOSE, so what prices the
// holding is the closing MARKET price, and that is a different number from the
// NAV per certificate the manager publishes for the same fund on the same day —
// an ETF trades at a premium or discount to its own NAV. Fmarket's feed settles
// the question anyway: it lists 68 open-ended funds and no ETF at all.
//
// The source is VNDirect's public chart history — the same series their web
// chart reads, no authentication. Unlike Fmarket it is one request per symbol,
// so every call goes through `boundedFetchText` for the shared six-at-a-time
// gate, and results are cached per symbol below.
const VNDIRECT_HISTORY_URL = 'https://dchart-api.vndirect.com.vn/dchart/history'

// How far back to ask. The exchange closes for up to nine days at Tết, and a
// window shorter than the longest break returns an empty series — which is
// indistinguishable from a ticker that does not exist.
const LOOKBACK_DAYS = 45

// A close older than this is not a price, it is a last known price. A halted or
// delisted ticker keeps answering with its final session forever; storing that
// would refresh `funds.updated_at` every night, and `updated_at` is what the
// dashboard's stale-price banner reads — so the stale figure would be the one
// thing on screen claiming to be fresh.
const MAX_BAR_AGE_DAYS = 14

// The feed quotes in THOUSANDS of đồng: 34.38 means 34,380 ₫ per certificate.
const DONG_PER_UNIT = 1000

// The band a quote in thousands can plausibly occupy, guarding the line above.
// This is not a judgement about the market — it is what catches the upstream
// switching units under us. A feed that started sending absolute đồng would
// otherwise have 34380 multiplied again into 34 million, and nothing downstream
// would notice: the DB check only asks for `nav >= 0.01`.
const MIN_QUOTE = 1
const MAX_QUOTE = 1000

const CACHE_TTL_MS = 60_000

/**
 * Tickers are typed by hand and pasted from broker apps, so "FUEVFVND",
 * "fue-vfvnd" and "FUE VFVND" all have to reach the same symbol. Takes unknown
 * because the code arrives from a PostgREST row: a shape surprise must degrade
 * to "this fund cannot be priced" rather than throw and abandon the run.
 */
export function normalizeSymbol(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

type Cached = { at: number; price: number | null }
const cache = new Map<string, Cached>()
// The request already running for a symbol. Without this, the nightly cron and a
// user-triggered refresh landing together each open their own request for the
// same ticker — the outbound semaphore paces them, it does not merge them.
const inFlight = new Map<string, Promise<number | null>>()

/** Exported for tests: module state outlives a single test file otherwise. */
export function clearEtfPriceCache(): void {
  cache.clear()
  inFlight.clear()
}

type Series = { t?: unknown; c?: unknown; s?: unknown }

/**
 * The last close, in đồng, or null when this symbol has no price worth storing.
 *
 * Null covers every way the ANSWER is unusable — unlisted ticker, empty series,
 * a body that is not the feed, a quote outside the band, a series that stopped
 * moving. A transport failure is not one of those: it says nothing about the
 * symbol, so it propagates and the caller decides (the refresh paths fail
 * closed, `isEtfSymbolPriceable` fails open).
 */
export async function fetchEtfMarketPrice(symbol: unknown, now: number = Date.now()): Promise<number | null> {
  const key = normalizeSymbol(symbol)
  if (key === '') return null

  const hit = cache.get(key)
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.price

  const running = inFlight.get(key)
  if (running) return running

  const request = fetchUncached(key, now)
  inFlight.set(key, request)
  try {
    const price = await request
    // Only a resolved answer is cached — including null, so one run does not ask
    // about the same unlisted ticker repeatedly. A throw is never cached: that
    // would turn one bad minute upstream into a minute of certain failure here.
    cache.set(key, { at: now, price })
    return price
  } finally {
    inFlight.delete(key)
  }
}

async function fetchUncached(symbol: string, now: number): Promise<number | null> {
  const to = Math.floor(now / 1000)
  const from = to - LOOKBACK_DAYS * 86_400
  const url = `${VNDIRECT_HISTORY_URL}?resolution=D&symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}`

  const body = await boundedFetchText(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'application/json, text/plain, */*',
    },
  })

  let series: Series
  try {
    series = JSON.parse(body) as Series
  } catch {
    return null
  }

  // A ticker the exchange does not list answers with HTTP 200 and an EMPTY body
  // — checked against the endpoint, not assumed. `boundedFetchText` only rejects
  // on status, so nothing upstream of here treats that as a failure; the parse
  // above turns it into null. `s` is the UDF convention's own marker for the
  // same thing, and anything other than an explicit "ok" is refused rather than
  // parsed hopefully.
  if (series.s !== 'ok') return null
  const times = series.t
  const closes = series.c
  if (!Array.isArray(times) || !Array.isArray(closes)) return null
  if (closes.length === 0 || times.length !== closes.length) return null

  const quote = closes[closes.length - 1]
  const at = times[times.length - 1]
  if (typeof quote !== 'number' || !isFinite(quote)) return null
  if (typeof at !== 'number' || !isFinite(at)) return null

  if (quote < MIN_QUOTE || quote > MAX_QUOTE) return null
  if ((now - at * 1000) / 86_400_000 > MAX_BAR_AGE_DAYS) return null

  // Rounded to the đồng: the multiplication is exact in decimal but not in
  // binary (29.385 × 1000 lands on 29384.999999999996), and HOSE prices ETFs in
  // ticks of ten đồng anyway.
  return Math.round(quote * DONG_PER_UNIT)
}

/**
 * Answers "would automatic pricing actually find this ticker?" at write time, so
 * a symbol that can never price is rejected while the user is still looking at
 * the form rather than saved happily and discovered broken at the next sync.
 *
 * Returns null for "couldn't check" — callers must fail OPEN on it. The feed
 * being unreachable says nothing about the ticker, and must not stop someone
 * editing their own fund. Mirrors `isFundCodePriceable` deliberately: the two
 * are picked between by fund type, so they have to answer the same way.
 */
export async function isEtfSymbolPriceable(symbol: unknown): Promise<boolean | null> {
  if (normalizeSymbol(symbol) === '') return false
  try {
    return (await fetchEtfMarketPrice(symbol)) !== null
  } catch {
    return null
  }
}
