'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { toast } from 'sonner'
import { useTheme, type ThemeChoice } from '@/app/components/ThemeProvider'
import { useNavigation } from '@/app/components/navigation/NavigationContext'
import type { DashboardData } from '@/features/dashboard/contracts'
import { useManagedTimeout } from './useManagedTimeout'
import {
  clearAppCaches, setLocaleCookie, refreshPrices, fetchOverview,
  exportPortfolioReport, fetchLastSync, formatLastSync,
} from './settingsShared'

// The React orchestration behind the settings page, shared by
// DesktopSettingsView and MobileSettingsView (#570). settingsShared already owns
// the network calls; each view used to wrap them in its own copy of the same
// controller — the same Supabase client, the same five sync flags with the same
// 3-second resets, the same profile save and export and sign-out. The copies had
// drifted: only mobile cleared its timers.
//
// What stays in the views is the chrome — desktop modals vs mobile sheets, the
// mobile top bar, and the layout each needs. Presentation, not behaviour.

/**
 * The price-sync card shows exactly one thing at a time, so the five booleans
 * the views carried were really one state with an illegal-combination problem
 * (`syncDone` and `syncPartial` were both set for a partial result).
 *
 * 'partial' means something synced but not everything — it still advances the
 * last-sync timestamp, because prices did move.
 */
export type SyncStatus = 'idle' | 'syncing' | 'done' | 'partial' | 'limited' | 'failed'

/** How long a sync outcome stays on screen before the card returns to idle. */
const SYNC_FLASH_MS = 3000

/** What the download sheet needs — the four headline numbers, nothing else. */
export interface ReportSummary {
  netWorth: number
  currentValue: number
  totalPL: number
  goalCount: number
}

export interface SettingsController {
  /** The name as edited here, which can be ahead of the server-rendered prop. */
  displayName: string
  initials: string
  /** True when the write succeeded — the views flash "Saved" only on true. */
  saveProfile: (name: string) => Promise<boolean>

  themeChoice: ThemeChoice
  selectTheme: (choice: ThemeChoice) => void

  switchLocale: (next: string) => void

  syncStatus: SyncStatus
  syncStatusLabel: string
  syncStatusColor: string
  /** undefined = loading, null = never synced, otherwise the last-sync ISO time. */
  lastSyncIso: string | null | undefined
  runSync: () => Promise<void>

  showReport: boolean
  openReport: () => void
  closeReport: () => void
  reportSummary: ReportSummary | null
  exportReport: () => Promise<void>

  signOut: () => Promise<void>
}

// Read the persisted theme *choice* (not the resolved theme) from localStorage,
// falling back to the resolved theme during SSR. 'system' is the absence of a
// stored value.
function readThemeChoice(fallback: ThemeChoice): ThemeChoice {
  if (typeof localStorage === 'undefined') return fallback
  const v = localStorage.getItem('theme')
  return (v === 'light' || v === 'dark') ? v : 'system'
}

function initialsOf(name: string, fallback: string): string {
  return name
    .split(/\s+/).slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '').join('') || fallback
}

export function useSettingsController({ initials, displayName }: {
  initials: string
  displayName: string
}): SettingsController {
  const locale = useLocale()
  const t = useTranslations('settings')
  const router = useRouter()
  const [, startTransition] = useTransition()
  const { theme: currentTheme, setTheme } = useTheme()
  const { setUserName } = useNavigation()

  const supabase = useMemo(
    () => createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ),
    []
  )

  // ─── Profile ──────────────────────────────────────────────────────────────

  const [localDisplayName, setLocalDisplayName] = useState(displayName)

  const saveProfile = useCallback(async (name: string): Promise<boolean> => {
    // Persist first. A failed update surfaces a toast and reports false so the
    // view keeps its form open instead of faking success over an unsaved name.
    const { error } = await supabase.auth.updateUser({ data: { display_name: name } })
    if (error) {
      toast.error(t('saveFailed'))
      return false
    }
    setLocalDisplayName(name)
    // Without this push the sidebar avatar/name stays stale until a refresh.
    setUserName(name)
    return true
  }, [supabase, t, setUserName])

  // ─── Appearance ───────────────────────────────────────────────────────────

  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(currentTheme)
  // Hydrate from the persisted choice after mount (avoids an SSR mismatch); the
  // two lint rules below are intentional for that reason.
  useEffect(() => { setThemeChoice(readThemeChoice(currentTheme)) }, []) // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect

  const selectTheme = useCallback((choice: ThemeChoice) => {
    setThemeChoice(choice)
    setTheme(choice)
  }, [setTheme])

  // ─── Language ─────────────────────────────────────────────────────────────

  const switchLocale = useCallback((next: string) => {
    setLocaleCookie(next)
    startTransition(() => router.refresh())
  }, [router])

  // ─── Price sync ───────────────────────────────────────────────────────────

  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle')
  const [lastSyncIso, setLastSyncIso] = useState<string | null | undefined>(undefined)
  const scheduleSyncStatusReset = useManagedTimeout()

  useEffect(() => { fetchLastSync().then(setLastSyncIso) }, [])

  const runSync = useCallback(async () => {
    setSyncStatus('syncing')
    const result = await refreshPrices()
    // A flash scheduled by an earlier sync can still be pending. Clearing it
    // blind would drop the card out of 'syncing' while a request is in flight,
    // so the reset only lands if the status it set is still showing.
    const clearFlash = (flashed: SyncStatus) =>
      scheduleSyncStatusReset(
        () => setSyncStatus(prev => (prev === flashed ? 'idle' : prev)),
        SYNC_FLASH_MS,
      )

    if (result.ok) {
      // Partial still advances the timestamp — prices did move, just not all.
      const flashed: SyncStatus = result.partial ? 'partial' : 'done'
      setSyncStatus(flashed)
      setLastSyncIso(new Date().toISOString())
      clearFlash(flashed)
    } else if (result.reason === 'rate-limited') {
      // Distinct from a failure: nothing is broken, the user just has to wait.
      setSyncStatus('limited')
      clearFlash('limited')
    } else {
      setSyncStatus('failed')
      clearFlash('failed')
    }
  }, [scheduleSyncStatusReset])

  const syncStatusLabel =
    syncStatus === 'syncing' ? t('syncUpdating')
    : syncStatus === 'partial' ? t('syncPartial')
    : syncStatus === 'done' ? t('syncUpdated')
    : syncStatus === 'limited' ? t('syncRateLimited')
    : syncStatus === 'failed' ? t('syncFailed')
    : `${t('lastSyncedPrefix')}${formatLastSync(lastSyncIso, locale)}`

  // Rate-limited and partial are neutral, not negative: nothing is broken — the
  // user is early, or some prices moved and some didn't.
  const syncStatusColor =
    syncStatus === 'done' ? 'var(--c-pos)'
    : syncStatus === 'failed' ? 'var(--c-neg)'
    : 'var(--c-muted)'

  // ─── Report export ────────────────────────────────────────────────────────

  const [showReport, setShowReport] = useState(false)
  const [overviewCache, setOverviewCache] = useState<DashboardData | null>(null)

  const openReport = useCallback(() => {
    setShowReport(true)
    // A failed prefetch must not block the sheet — the export path re-fetches
    // and surfaces its own error.
    fetchOverview().then((json) => { if (json) setOverviewCache(json) })
  }, [])

  const closeReport = useCallback(() => setShowReport(false), [])

  const exportReport = useCallback(
    () => exportPortfolioReport(locale),
    [locale],
  )

  const reportSummary: ReportSummary | null = overviewCache ? {
    netWorth: overviewCache.netWorth.netWorth,
    currentValue: overviewCache.netWorth.currentValue,
    totalPL: overviewCache.netWorth.overallProfitLoss,
    goalCount: overviewCache.goals.length,
  } : null

  // ─── Session ──────────────────────────────────────────────────────────────

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) {
      // Clearing caches here would log the user out locally while the session
      // is still live on the server.
      toast.error(t('signOutFailed'))
      return
    }
    await clearAppCaches()
    router.push('/auth/login')
  }, [supabase, t, router])

  return {
    displayName: localDisplayName,
    initials: initialsOf(localDisplayName, initials),
    saveProfile,
    themeChoice,
    selectTheme,
    switchLocale,
    syncStatus,
    syncStatusLabel,
    syncStatusColor,
    lastSyncIso,
    runSync,
    showReport,
    openReport,
    closeReport,
    reportSummary,
    exportReport,
    signOut,
  }
}
