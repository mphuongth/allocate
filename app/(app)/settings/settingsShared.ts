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

// Kick both price refreshers. Returns true only when both endpoints responded
// ok, so callers can surface a failure instead of always reporting success.
// Network/parse errors resolve to false rather than throwing (best-effort).
export async function refreshPrices(): Promise<boolean> {
  try {
    const results = await Promise.all([
      fetch('/api/cron/refresh-navs'),
      fetch('/api/cron/refresh-gold'),
    ])
    return results.every((r) => r.ok)
  } catch {
    return false
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
