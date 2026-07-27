// Shared logic for the two settings views — DesktopSettingsView and
// MobileSettingsView render the same preferences with different chrome. The
// pure cores of their handlers (previously copy-pasted byte-for-byte) live
// here; each view keeps its own state wiring.

import type { DashboardData } from '@/app/assets/DashboardClient'

// localStorage cache keys cleared on sign-out so the next account never sees
// the previous user's stale data.
const APP_CACHE_PREFIXES = [
  'dashboardOverviewCache',
  'planningCache_',
  'savingsGoalsCache',
  'fixedExpensesCache',
  'insuranceMembersCache',
  'fundLibraryCache',
]

export function clearAppCaches(): void {
  Object.keys(localStorage)
    .filter((k) => APP_CACHE_PREFIXES.some((p) => k.startsWith(p)))
    .forEach((k) => localStorage.removeItem(k))
}

// Persist the chosen locale for a year; callers refresh the router afterward.
export function setLocaleCookie(next: string): void {
  document.cookie = `locale=${next};path=/;max-age=31536000;SameSite=Lax`
}

export type SyncResult =
  | { ok: true }
  | { ok: false; reason: 'rate-limited'; retryAfterSeconds: number }
  | { ok: false; reason: 'error' }

// Fallback when a 429 arrives without a usable Retry-After. Both limiters use a
// 60-second fixed window, so this is the longest a caller could need to wait.
const DEFAULT_RETRY_AFTER_SECONDS = 60

// Did the NAV refresh actually move anything?
//
// /api/v1/funds/refresh-nav returns 200 with `{ results: [...] }`, where each
// entry is either an updated fund or `{ error }` — including when every single
// one failed. So HTTP status can't answer this on its own.
//
// A user with no priced funds gets `results: []`, which is nothing to do rather
// than a failure. A body we can't read counts as failure: claiming success we
// can't verify is exactly the habit this endpoint's status already encourages.
//
// Partial failures still count as success — some prices did move. Surfacing
// "3 of 5 funds updated" needs a UI state and wording of its own, so it's left
// for a follow-up rather than guessed at here.
async function navUpdatedSomething(navRes: Response): Promise<boolean> {
  try {
    const body = await navRes.json()
    const results = body?.results
    if (!Array.isArray(results)) return false
    if (results.length === 0) return true
    return results.some((r: { error?: unknown }) => !r?.error)
  } catch {
    return false
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
    const [navRes, goldRes] = await Promise.all([
      fetch('/api/v1/funds/refresh-nav', { method: 'POST' }),
      fetch('/api/v1/gold-price/refresh', { method: 'POST' }),
    ])
    const results = [navRes, goldRes]

    if (results.every((r) => r.ok)) {
      // A 200 from refresh-nav doesn't mean the NAVs moved: it answers with
      // per-fund results and stays 200 even when every scrape failed. Reporting
      // "Updated" then — and stamping a fresh "last synced" over stale NAVs — is
      // the same lie in a different place, so check what actually happened.
      return (await navUpdatedSomething(navRes)) ? { ok: true } : { ok: false, reason: 'error' }
    }

    // Rate limiting wins over a generic failure when both happen: it's the one
    // the user can do something about.
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
