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

// Kick both price refreshers; errors are intentionally swallowed (best-effort).
export async function refreshPrices(): Promise<void> {
  try {
    await Promise.all([
      fetch('/api/cron/refresh-navs'),
      fetch('/api/cron/refresh-gold'),
    ])
  } catch {
    // ignore — sync is best-effort
  }
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
