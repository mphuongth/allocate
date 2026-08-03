import type { DashboardData } from '@/features/dashboard/contracts'

const OVERVIEW_ENDPOINT = '/api/v1/dashboard/overview'

const OVERVIEW_CACHE_TTL = 2 * 60 * 1000 // 2 minutes

// Bump when the cached shape gains a field a consumer RELIES on, so a payload
// written by the previous deploy is never served to code that needs the new one.
// v2: fund items carry `costBasis`, which the sell flow posts as the withdrawn
// principal (#587). Served without it, a sale falls back to a figure the database
// refuses — a pre-deploy snapshot is stale in a way the TTL cannot express, and
// `allowStale` reads have no age bound at all.
const OVERVIEW_CACHE_SCHEMA = 'v2'

function overviewCacheKey(userId: string) {
  return `dashboardOverviewCache_${OVERVIEW_CACHE_SCHEMA}_${userId}`
}

/**
 * Read the cached overview snapshot. Returns null past its TTL unless
 * `allowStale` is set — callers fall back to a stale snapshot when a refresh
 * fails so a transient network/cold-start blip never blanks the dashboard.
 */
export function getCachedOverview(
  userId: string,
  opts?: { allowStale?: boolean },
): DashboardData | null {
  try {
    const raw = localStorage.getItem(overviewCacheKey(userId))
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    if (!opts?.allowStale && Date.now() - ts > OVERVIEW_CACHE_TTL) return null
    return data
  } catch {
    return null
  }
}

export function setCachedOverview(userId: string, data: DashboardData) {
  try {
    localStorage.setItem(overviewCacheKey(userId), JSON.stringify({ data, ts: Date.now() }))
  } catch {
    /* ignore */
  }
}

export interface AllocationTotals {
  /**
   * Every fund holding's value, regardless of `fund_type`. We deliberately sum
   * ALL fund items (not just equity/debt/balanced) so a fund with an unexpected
   * type — e.g. money_market/cash — still lands in the "Fund" bucket of the
   * allocation bar instead of silently disappearing from it while still
   * counting toward net worth (#363 review #3).
   */
  fundTotal: number
  bankTotal: number
  goldTotal: number
  stockTotal: number
}

/** Build the allocation-bar buckets from the overview payload. Pure + testable. */
export function computeAllocationTotals(data: DashboardData): AllocationTotals {
  const allFundItems = [...data.goals.flatMap((g) => g.funds), ...data.unallocated.funds]
  const fundTotal = allFundItems.reduce((sum, f) => sum + f.currentValue, 0)
  const { bank: bankTotal, gold: goldTotal, stock: stockTotal } = data.byType
  return { fundTotal, bankTotal, goldTotal, stockTotal }
}

export interface OverviewLoadResult {
  data: DashboardData | null
  /** Raw error string from the response body, if any (untranslated). */
  error: string | null
  /** True when the failure was a 5xx / network reject (incl. the SW's synthetic 503). */
  transient: boolean
  /** True when `data` came from the stale cache rather than a fresh response. */
  fromCache: boolean
}

/**
 * Load the dashboard overview with resilience against slow cold starts.
 *
 * The service worker aborts a slow `/api/v1` request and substitutes a
 * synthetic `{ error: 'Offline' }` 503. A single such hiccup used to blank the
 * dashboard to a hard error. Here we retry once (the retry hits a now-warm
 * function) and, if it still fails transiently, fall back to the last cached
 * snapshot — surfacing an error only when there is genuinely nothing to show.
 */
export async function loadOverview(deps: {
  fetchFn?: typeof fetch
  getCache: (allowStale: boolean) => DashboardData | null
  setCache: (data: DashboardData) => void
  retries?: number
}): Promise<OverviewLoadResult> {
  const fetchFn = deps.fetchFn ?? fetch
  const retries = deps.retries ?? 1

  let lastError: string | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchFn(OVERVIEW_ENDPOINT, { cache: 'no-store' })
      if (res.ok) {
        const data = (await res.json()) as DashboardData
        deps.setCache(data)
        return { data, error: null, transient: false, fromCache: false }
      }

      const body = (await res.json().catch(() => ({}))) as { error?: string }
      lastError = body.error ?? null
      // 5xx (including the SW's synthetic 503) is transient → worth a retry.
      // A 4xx is a definitive answer (e.g. 401) — surface it immediately.
      if (res.status < 500) {
        return { data: null, error: lastError, transient: false, fromCache: false }
      }
      if (attempt < retries) continue
      break // transient but out of retries → fall through to the cache
    } catch {
      // Network rejection — transient.
      lastError = null
      if (attempt < retries) continue
      break
    }
  }

  // All attempts failed transiently. Prefer a stale snapshot over an error screen.
  const cached = deps.getCache(true)
  if (cached) return { data: cached, error: null, transient: true, fromCache: true }
  return { data: null, error: lastError, transient: true, fromCache: false }
}

/**
 * Decide the banner text for a load result. Returns null when there is data to
 * show (no banner). Transient failures map to the localized generic error so
 * the raw service-worker "Offline" string never reaches the user.
 */
export function overviewErrorText(result: OverviewLoadResult, genericError: string): string | null {
  if (result.data) return null
  if (result.transient) return genericError
  return result.error ?? genericError
}
