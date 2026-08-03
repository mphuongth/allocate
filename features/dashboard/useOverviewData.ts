'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  loadOverview,
  overviewErrorText,
  getCachedOverview,
  setCachedOverview,
} from './overviewData'
import type { DashboardData } from './contracts'

// How long the app may sit backgrounded before a foreground counts as stale.
// Also the bound on the initial load in a PWA, which resumes from a force-quit
// with whatever was on screen when the user left.
const PWA_STALE_MS = 30_000

// How far the user must pull before the gesture triggers a refresh.
const PULL_THRESHOLD = 65

/** Standalone display mode — an installed PWA rather than a browser tab. */
function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as { standalone?: boolean }).standalone === true
}

export interface OverviewState {
  data: DashboardData | null
  /** First paint has no data yet — show the skeleton. */
  loading: boolean
  /** Data is on screen and being refreshed — show the number pulse, not a skeleton. */
  refreshing: boolean
  error: string
  /** Pull-to-refresh travel in px (PWA only); 0 when not pulling. */
  pullY: number
  /** Bumped on every successful load, so the net-worth chart refetches with it. */
  historyKey: number
  /**
   * Force the chart to refetch without reloading the overview. Saving a
   * transaction changes the net-worth history whether or not the overview
   * reload that follows happens to succeed.
   */
  bumpHistoryKey: () => void
  refresh: (opts?: { force?: boolean }) => Promise<void>
}

/**
 * Owns the dashboard's data lifecycle (#602) — everything DashboardClient used
 * to spread across five effects and eight useState calls.
 *
 * Cache-first: a fresh cached snapshot paints immediately with no request.
 * `force` skips the cache. A load with data already on screen refreshes
 * silently — the full skeleton only ever appears on first paint.
 *
 * The three PWA-only behaviors (bust a >30s-old cache on launch, refetch when
 * foregrounded after >30s, pull-to-refresh) are no-ops in a browser tab.
 *
 * @param errorText Localised fallback message for a load that fails with no
 *   cache to fall back on. Passed in because this layer doesn't do i18n.
 */
export function useOverviewData(userId: string, errorText: string): OverviewState {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [pullY, setPullY] = useState(0)
  const [historyKey, setHistoryKey] = useState(0)

  const hasDataRef = useRef(false)
  // The gesture and visibility listeners are bound once, so they read the
  // current refresh through a ref rather than re-binding on every identity change.
  const refreshRef = useRef<(opts?: { force?: boolean }) => Promise<void>>(async () => {})
  const touchStartY = useRef(-1)

  const refresh = useCallback(async (opts?: { force?: boolean }) => {
    const cached = !opts?.force && getCachedOverview(userId)
    if (cached) {
      setData(cached)
      hasDataRef.current = true
      setLoading(false)
      return
    }
    // Only show the skeleton on initial load — if data is already visible,
    // refresh silently with the number-refresh pulse instead.
    if (!hasDataRef.current) setLoading(true)
    else setRefreshing(true)
    setError('')

    // Resilient load: retries once on a transient failure (e.g. the service
    // worker's synthetic "Offline" 503 from a slow cold start) and falls back to
    // the last cached snapshot before ever surfacing an error banner.
    const result = await loadOverview({
      getCache: (allowStale) => getCachedOverview(userId, { allowStale }),
      setCache: (json) => setCachedOverview(userId, json),
    })

    if (result.data) {
      setData(result.data)
      hasDataRef.current = true
      setHistoryKey((k) => k + 1)
      // Only mark a real network refresh (not a stale-cache fallback) so the PWA
      // foreground-staleness check still triggers a true refetch later.
      if (!result.fromCache) {
        try { localStorage.setItem('pwa_last_fetch', String(Date.now())) } catch {}
      }
    }
    setError(overviewErrorText(result, errorText) ?? '')
    setLoading(false)
    setRefreshing(false)
  }, [userId, errorText])

  const bumpHistoryKey = useCallback(() => setHistoryKey((k) => k + 1), [])

  useEffect(() => { refreshRef.current = refresh }, [refresh])

  // Initial load. In a PWA, bust the cache if the last fetch was over 30s ago —
  // that covers force-quit + reopen, where the process resumes with stale state.
  useEffect(() => {
    if (!isStandalone()) { refresh(); return }
    try {
      const last = localStorage.getItem('pwa_last_fetch')
      const stale = !last || Date.now() - Number(last) > PWA_STALE_MS
      refresh(stale ? { force: true } : undefined)
    } catch { refresh() }
  }, [refresh])

  // PWA only: refresh when foregrounded after more than 30s in the background.
  useEffect(() => {
    if (!isStandalone()) return
    let hiddenAt = 0
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
      } else if (hiddenAt > 0 && Date.now() - hiddenAt > PWA_STALE_MS) {
        refreshRef.current({ force: true })
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  // PWA only: pull-to-refresh.
  useEffect(() => {
    if (!isStandalone()) return
    let pullCurrent = 0
    const onTouchStart = (e: TouchEvent) => {
      touchStartY.current = window.scrollY === 0 ? e.touches[0].clientY : -1
    }
    const onTouchMove = (e: TouchEvent) => {
      if (touchStartY.current < 0) return
      const delta = e.touches[0].clientY - touchStartY.current
      if (delta > 0) {
        pullCurrent = Math.min(delta * 0.5, 80)
        setPullY(pullCurrent)
      }
    }
    const onTouchEnd = () => {
      if (pullCurrent >= PULL_THRESHOLD) refreshRef.current({ force: true })
      pullCurrent = 0
      setPullY(0)
      touchStartY.current = -1
    }
    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: true })
    document.addEventListener('touchend', onTouchEnd)
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  return { data, loading, refreshing, error, pullY, historyKey, bumpHistoryKey, refresh }
}
