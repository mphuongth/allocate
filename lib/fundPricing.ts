import { fetchFmarketNavIndex, lookupFundNav } from './fmarket-nav'
import { fetchEtfMarketPrice, normalizeSymbol } from './hose-price'

// One place that answers "what is this fund worth per unit today", for both
// refresh paths — the nightly cron and the user's Refresh button.
//
// Until ETFs there was one source, so each route inlined it: fetch the Fmarket
// index, look every code up, done. With two sources that inline version would be
// copied twice and would have to make the same three judgements twice — which
// source prices which fund, what happens when a source is down, and what happens
// when a source simply doesn't list a code. The routes keep what genuinely
// differs between them (rate limiting, auth, how they report), and this holds
// what must not drift apart.

/** The two columns pricing needs off a `funds` row. */
interface FundPriceRow {
  code: string
  fund_type?: string | null
}

type FundPriceOutcome =
  | { ok: true; price: number }
  | { ok: false; error: string }

/**
 * Only the exact value routes to the exchange. A legacy row with a null type, or
 * a type added later, keeps pricing the way it priced yesterday rather than
 * asking HOSE about a code HOSE never heard of.
 */
const isEtf = (row: FundPriceRow) => row.fund_type === 'etf'

const message = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)

/**
 * Price every row, keyed by the row object the caller passed in.
 *
 * Each row gets its own outcome, and a source failing is a failure of ITS rows
 * only. The single-source cron used to abandon every fund the moment its one
 * request failed; carried forward, that would have let a bad minute at Fmarket
 * freeze ETF prices that were perfectly obtainable — and vice versa.
 */
export async function priceAutoSyncFunds<T extends FundPriceRow>(
  rows: readonly T[],
): Promise<Map<T, FundPriceOutcome>> {
  const out = new Map<T, FundPriceOutcome>()
  if (rows.length === 0) return out

  const etfRows = rows.filter(isEtf)
  const fundRows = rows.filter((row) => !isEtf(row))

  await Promise.all([priceOpenEnded(fundRows, out), priceEtfs(etfRows, out)])
  return out
}

async function priceOpenEnded<T extends FundPriceRow>(rows: readonly T[], out: Map<T, FundPriceOutcome>) {
  // One request prices every open-ended fund, so it is worth nothing when there
  // are none — an all-ETF portfolio must not pull the whole product list down.
  if (rows.length === 0) return

  let index
  try {
    index = await fetchFmarketNavIndex()
  } catch (err) {
    const error = message(err, 'Failed to fetch fund prices')
    for (const row of rows) out.set(row, { ok: false, error })
    return
  }

  for (const row of rows) {
    const nav = lookupFundNav(index, row.code)
    out.set(row, nav === null
      ? { ok: false, error: `No fund matching code "${row.code}" is listed upstream` }
      : { ok: true, price: nav })
  }
}

async function priceEtfs<T extends FundPriceRow>(rows: readonly T[], out: Map<T, FundPriceOutcome>) {
  // The exchange is one request per ticker, so ask per DISTINCT ticker: the cron
  // sees a row per user, and two people holding the same ETF is the normal case.
  const symbols = [...new Set(rows.map((row) => normalizeSymbol(row.code)))]
  const quotes = new Map<string, FundPriceOutcome>()

  await Promise.all(symbols.map(async (symbol) => {
    try {
      const price = await fetchEtfMarketPrice(symbol)
      quotes.set(symbol, price === null
        ? { ok: false, error: `No ETF matching code "${symbol}" is listed on the exchange` }
        : { ok: true, price })
    } catch (err) {
      quotes.set(symbol, { ok: false, error: message(err, 'Failed to fetch ETF prices') })
    }
  }))

  for (const row of rows) {
    out.set(row, quotes.get(normalizeSymbol(row.code)) ?? {
      ok: false,
      error: `No ETF matching code "${row.code}" is listed on the exchange`,
    })
  }
}
