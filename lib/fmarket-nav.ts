import { boundedFetchText } from './boundedFetch'

// Every fund NAV in the app now comes from one place: Fmarket's public product
// feed, which is the distributor the funds themselves publish through.
//
// It replaced four per-provider scrapers because all four had rotted in
// different ways and one of them was unfixable:
//   - VinaCapital sits entirely behind Cloudflare. Every HTML path answers 403
//     with a challenge page to any datacenter IP, so no server-side scrape can
//     work — not a regex problem, an access problem.
//   - SSIAM's fund pages grew past 6 MB, over the scrape byte cap.
//   - VCBF embeds all seven of its funds in one blob and the scraper mapped only
//     three by URL substring; the other four silently fell through to the bond
//     fund's price, so VCBF-BCF was stored ~60% low with no error at all.
//   - Dragon Capital worked, but only via a 15-request fan-out over fund codes.
//
// One request now covers all of them, and the values were verified row-by-row
// against each provider's own site before the switch.
export const FMARKET_FILTER_URL = 'https://api.fmarket.vn/res/products/filter'

// The feed is a filter endpoint, so it needs a body even to list everything.
// pageSize is well above the ~68 funds it currently returns: paginating would
// mean a second request whose only job is to discover it wasn't needed, and a
// short page would silently drop funds rather than fail.
const FILTER_BODY = {
  types: ['NEW_FUND', 'TRADING_FUND'],
  issuerIds: [],
  sortOrder: 'DESC',
  sortField: 'navTo6Months',
  page: 1,
  pageSize: 500,
  isIpo: false,
  fundAssetTypes: [],
  bondRemainPeriods: [],
  searchField: '',
  isBuyByReward: false,
  thirdAppIds: [],
}

// Fund codes are written inconsistently by humans and by providers alike:
// "VCBF-BCF", "VCBFBCF", "vcbf bcf" and "SSI-SCA" vs "SSISCA" are all the same
// fund. Comparing on letters and digits only makes those collapse to one key.
// Takes unknown rather than string: the code arrives from a PostgREST row, and
// a shape surprise there must degrade to "this fund can't be matched" — one
// per-fund error — rather than throw and abandon the refresh for every fund.
export function normalizeFundCode(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export type NavIndex = Map<string, number>

type FmarketRow = { shortName?: unknown; code?: unknown; nav?: unknown }

// Builds the lookup from BOTH identifiers each row carries — `shortName` is the
// hyphenated form ("VCBF-BCF") and `code` the compact one ("VCBFBCF") — because
// a stored fund code may have been copied from either.
export function buildNavIndex(rows: unknown): NavIndex {
  if (!Array.isArray(rows)) throw new Error('Fmarket: product list was not an array')

  const index: NavIndex = new Map()
  for (const row of rows as FmarketRow[]) {
    const nav = row?.nav
    // A fund that hasn't priced yet reports nav 0. Indexing it would let a
    // refresh overwrite a good NAV with zero, which the DB's nav >= 0.01 check
    // would then reject as a confusing write failure rather than a skip.
    if (typeof nav !== 'number' || !isFinite(nav) || nav <= 0) continue
    for (const id of [row?.shortName, row?.code]) {
      if (typeof id === 'string' && id.trim() !== '') index.set(normalizeFundCode(id), nav)
    }
  }

  if (index.size === 0) throw new Error('Fmarket: product list contained no priced funds')
  return index
}

export async function fetchFmarketNavIndex(): Promise<NavIndex> {
  const body = await boundedFetchText(FMARKET_FILTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'application/json',
    },
    body: JSON.stringify(FILTER_BODY),
  })

  let rows: unknown
  try {
    rows = (JSON.parse(body) as { data?: { rows?: unknown } })?.data?.rows
  } catch {
    throw new Error('Fmarket: response was not JSON')
  }
  return buildNavIndex(rows)
}

// Exact match on the normalized code, then a unique-suffix fallback so a fund
// stored as bare "BCF" still resolves to "VCBFBCF". The fallback insists on
// exactly one candidate: an ambiguous suffix must fail loudly for that one fund
// rather than pick a plausible neighbour and store a wrong price, which is the
// exact failure mode the VCBF scraper had.
export function lookupFundNav(index: NavIndex, code: unknown): number | null {
  const key = normalizeFundCode(code)
  if (key === '') return null

  const exact = index.get(key)
  if (exact !== undefined) return exact

  const candidates = new Set<number>()
  for (const [indexed, nav] of index) {
    if (indexed.endsWith(key)) candidates.add(nav)
  }

  return candidates.size === 1 ? [...candidates][0] : null
}

// Answers "would automatic pricing actually find this fund?" at write time, so a
// code that can never price is rejected while the user is still looking at the
// form — rather than saved happily and discovered broken at the next sync.
//
// Returns null for "couldn't check". The upstream feed being down says nothing
// about the code, and must not stop someone editing their own fund: callers are
// expected to fail OPEN on null. That is the opposite of the refresh routes,
// which fail closed — there, an unverifiable price is a price not worth storing;
// here, an unverifiable code is no reason to block a save.
export async function isFundCodePriceable(code: unknown): Promise<boolean | null> {
  if (normalizeFundCode(code) === '') return false
  try {
    const index = await fetchFmarketNavIndex()
    return lookupFundNav(index, code) !== null
  } catch {
    return null
  }
}
