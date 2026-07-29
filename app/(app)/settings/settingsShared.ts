// Shared logic for the two settings views — DesktopSettingsView and
// MobileSettingsView render the same preferences with different chrome. The
// pure cores of their handlers (previously copy-pasted byte-for-byte) live
// here; each view keeps its own state wiring.

import type { DashboardData } from '@/app/assets/DashboardClient'

// Moved to lib/clientCache so the sign-out in UserMenu shares one definition of
// "this account's caches" — which now spans the service worker's Cache Storage,
// not just localStorage. Re-exported here because both settings views already
// import it from this module.
export { clearAppCaches } from '@/lib/clientCache'

// Moved to lib/locale so the landing page's toggle can share it; re-exported
// here because both settings views already import it from this module.
export { setLocaleCookie } from '@/lib/locale'

// `partial` means something synced but not everything — gold updated while some
// or all fund NAVs failed. It stays `ok: true` deliberately: prices did move, so
// the last-sync timestamp should advance and the caches should be busted. Only
// the wording differs.
export type SyncResult =
  | { ok: true; partial?: true }
  | { ok: false; reason: 'rate-limited'; retryAfterSeconds: number }
  | { ok: false; reason: 'error' }

// Caches built from the prices a sync changes. The dashboard overview is served
// from localStorage for 2 minutes (OVERVIEW_CACHE_TTL), so without this a user
// who viewed the dashboard just before syncing returns to the same stale numbers
// and the sync looks like it did nothing. The transaction ledger busts the same
// cache after its own mutations.
//
// Scoped to price-dependent caches only: goals, plans and expenses can't be
// changed by a price refresh, and dropping them would make every sync re-fetch
// the whole app for nothing.
const PRICE_DEPENDENT_CACHE_PREFIXES = ['dashboardOverviewCache', 'fundLibraryCache']

function bustPriceDependentCaches(): void {
  try {
    Object.keys(localStorage)
      .filter((k) => PRICE_DEPENDENT_CACHE_PREFIXES.some((p) => k.startsWith(p)))
      .forEach((k) => localStorage.removeItem(k))
  } catch { /* ignore — a failed cache bust must not fail the sync */ }
}

// Fallback when a 429 arrives without a usable Retry-After. Both limiters use a
// 60-second fixed window, so this is the longest a caller could need to wait.
const DEFAULT_RETRY_AFTER_SECONDS = 60

// What did the NAV refresh actually do?
//
//   'updated'  — every fund it tried came back with a new NAV
//   'partial'  — some funds updated, some errored
//   'nothing'  — the user has no priced funds; nothing to do, nothing broken
//   'failed'   — the request failed, every fund errored, or the body is unreadable
//
// /api/v1/funds/refresh-nav returns 200 with `{ results: [...] }`, where each
// entry is either an updated fund or `{ error }` — including when every single
// one failed. So HTTP status can't answer this on its own.
//
// 'nothing' is kept distinct from 'updated' because it persisted nothing: if
// gold is also refused, the sync moved nothing at all and shouldn't read as
// partly successful. An unreadable body counts as failed — claiming success we
// can't verify is exactly the habit this endpoint's status already encourages.
type NavOutcome = 'updated' | 'partial' | 'nothing' | 'failed'

async function readNavOutcome(navRes: Response): Promise<NavOutcome> {
  if (!navRes.ok) return 'failed'
  try {
    const body = await navRes.json()
    const results = body?.results
    if (!Array.isArray(results)) return 'failed'
    if (results.length === 0) return 'nothing'
    const failures = results.filter((r: { error?: unknown }) => r?.error).length
    if (failures === 0) return 'updated'
    return failures === results.length ? 'failed' : 'partial'
  } catch {
    return 'failed'
  }
}

// Kick both price refreshers for the CURRENT USER.
//
// These used to be the cron routes (/api/cron/refresh-*), which gate on
// CRON_SECRET in an Authorization header a browser fetch doesn't send — so every
// click returned 401 and the button reported "Sync failed" (#552). The v1
// endpoints authenticate by session cookie, act on the caller's own funds and
// gold settings rather than every row in the table, and are rate-limited so a
// button can't be used to hammer the upstream providers.
//
// A 429 is reported separately from a generic failure: it's the user's own doing
// and clears itself, so "wait a moment" is actionable in a way "Sync failed"
// isn't. Network/parse errors resolve to an error result rather than throwing.
export async function refreshPrices(): Promise<SyncResult> {
  try {
    // allSettled, not all: these are two independent operations and either can
    // die on its own — a transport-level rejection on one would otherwise throw
    // away what the other already persisted, exactly as a shared HTTP verdict
    // did. The limits differ on purpose too (NAV 5/min, gold 10/min), so a rapid
    // sixth sync limits NAV while gold still writes a new price.
    const [navSettled, goldSettled] = await Promise.allSettled([
      fetch('/api/v1/funds/refresh-nav', { method: 'POST' }),
      fetch('/api/v1/gold-price/refresh', { method: 'POST' }),
    ])
    const navRes = navSettled.status === 'fulfilled' ? navSettled.value : null
    const goldRes = goldSettled.status === 'fulfilled' ? goldSettled.value : null
    const results = [navRes, goldRes].filter((r): r is Response => r !== null)

    const nav = navRes ? await readNavOutcome(navRes) : 'failed'
    const goldSucceeded = goldRes?.ok === true

    // A 200 from refresh-nav doesn't mean the NAVs moved: it answers with
    // per-fund results and stays 200 even when every scrape failed.
    const allClean = nav !== 'failed' && nav !== 'partial' && goldSucceeded
    const anythingPersisted = nav === 'updated' || nav === 'partial' || goldSucceeded

    if (allClean) {
      bustPriceDependentCaches()
      return { ok: true }
    }
    if (anythingPersisted) {
      bustPriceDependentCaches()
      return { ok: true, partial: true }
    }

    // Nothing moved. Rate limiting wins over a generic failure: it's the one the
    // user can do something about.
    const limited = results.filter((r) => r.status === 429)
    if (limited.length > 0) {
      const retryAfterSeconds = Math.max(
        ...limited.map((r) => {
          const header = Number(r.headers.get('Retry-After'))
          return Number.isFinite(header) && header > 0 ? header : DEFAULT_RETRY_AFTER_SECONDS
        }),
      )
      return { ok: false, reason: 'rate-limited', retryAfterSeconds }
    }

    return { ok: false, reason: 'error' }
  } catch {
    return { ok: false, reason: 'error' }
  }
}

// Fetch the most recent price-sync time for the current user — the latest
// updated_at across their funds (NAV) and gold price. Returns an ISO string, or
// null when nothing has synced yet or the request fails.
export async function fetchLastSync(): Promise<string | null> {
  try {
    const res = await fetch('/api/v1/prices/last-sync', { cache: 'no-store' })
    if (!res.ok) return null
    const json = await res.json()
    return json?.lastSync ?? null
  } catch {
    return null
  }
}

// Format a price-sync timestamp into a compact, bilingual relative phrase for
// the Price sync card (e.g. "2h ago" / "2 giờ trước"). `now` is injectable for
// deterministic tests. `undefined` renders a loading placeholder; `null` (never
// synced) renders a distinct label.
export function formatLastSync(
  iso: string | null | undefined,
  locale: string,
  now: number = Date.now(),
): string {
  const isVI = locale === 'vi'
  if (iso === undefined) return '…'
  if (iso === null) return isVI ? 'Chưa đồng bộ' : 'Never'

  const mins = Math.floor((now - new Date(iso).getTime()) / 60000)
  if (mins < 1) return isVI ? 'vừa xong' : 'just now'
  if (mins < 60) return isVI ? `${mins} phút trước` : `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return isVI ? `${hours} giờ trước` : `${hours}h ago`
  const days = Math.floor(hours / 24)
  return isVI ? `${days} ngày trước` : `${days}d ago`
}

// Prefetch the dashboard overview for the report sheet. Returns null on any
// failure (the export path re-fetches and surfaces the error itself).
export async function fetchOverview(): Promise<DashboardData | null> {
  try {
    const res = await fetch('/api/v1/dashboard/overview', { cache: 'no-store' })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

// Export the portfolio PDF, reusing the prefetched overview when available.
export async function exportPortfolioReport(
  overviewCache: DashboardData | null,
  locale: string,
): Promise<void> {
  let data = overviewCache
  if (!data) {
    const res = await fetch('/api/v1/dashboard/overview', { cache: 'no-store' })
    if (!res.ok) throw new Error('Failed to load portfolio data')
    data = await res.json()
  }
  const { downloadPortfolioPDF } = await import('@/lib/generateReport')
  await downloadPortfolioPDF(data!, locale)
}
