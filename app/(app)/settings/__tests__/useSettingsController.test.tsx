import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSettingsController } from '../useSettingsController'

// The desktop and mobile settings views each carried their own controller around
// settingsShared: the same Supabase client, the same five sync flags with the
// same 3-second resets, the same profile save, the same export and sign-out
// (#570). The copies had already drifted — only mobile cleared its timers.
// Testing the shared controller is what proves both viewports now behave the
// same, since what remains in each view is modals vs sheets.

const { signOutMock, updateUserMock, setUserNameMock, toastErrorMock, setThemeMock, refreshMock, pushMock } = vi.hoisted(() => ({
  signOutMock: vi.fn().mockResolvedValue({ error: null }),
  updateUserMock: vi.fn().mockResolvedValue({ data: { user: {} }, error: null }),
  setUserNameMock: vi.fn(),
  toastErrorMock: vi.fn(),
  setThemeMock: vi.fn(),
  refreshMock: vi.fn(),
  pushMock: vi.fn(),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}))

vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: vi.fn() } }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}))

vi.mock('@/components/navigation/NavigationContext', () => ({
  useNavigation: () => ({ setMobileTopBar: vi.fn(), setUserName: setUserNameMock }),
}))

vi.mock('@/components/layout/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn(), setTheme: setThemeMock }),
}))

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: () => ({ auth: { signOut: signOutMock, updateUser: updateUserMock } }),
}))

const { refreshPricesMock, fetchLastSyncMock, fetchOverviewMock, exportReportMock, clearAppCachesMock, setLocaleCookieMock } = vi.hoisted(() => ({
  refreshPricesMock: vi.fn(),
  fetchLastSyncMock: vi.fn().mockResolvedValue(null),
  fetchOverviewMock: vi.fn().mockResolvedValue(null),
  exportReportMock: vi.fn().mockResolvedValue(undefined),
  clearAppCachesMock: vi.fn().mockResolvedValue(undefined),
  setLocaleCookieMock: vi.fn(),
}))

vi.mock('../settingsShared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../settingsShared')>()
  return {
    ...actual,
    refreshPrices: refreshPricesMock,
    fetchLastSync: fetchLastSyncMock,
    fetchOverview: fetchOverviewMock,
    exportPortfolioReport: exportReportMock,
    clearAppCaches: clearAppCachesMock,
    setLocaleCookie: setLocaleCookieMock,
  }
})

const PROPS = { initials: 'PT', displayName: 'Phuong' }

function setup() {
  return renderHook(() => useSettingsController(PROPS))
}

// Let the effects that fire on mount (last-sync, theme hydration) settle so a
// later assertion isn't racing an unflushed promise.
async function mounted() {
  const rendered = setup()
  await act(async () => {})
  return rendered
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchLastSyncMock.mockResolvedValue(null)
  fetchOverviewMock.mockResolvedValue(null)
  localStorage.clear()
})
afterEach(() => { vi.useRealTimers() })

// ─── Profile ─────────────────────────────────────────────────────────────────

describe('useSettingsController — profile', () => {
  it('derives initials from the display name', async () => {
    const { result } = await mounted()
    expect(result.current.displayName).toBe('Phuong')
    expect(result.current.initials).toBe('P')
  })

  it('falls back to the server initials when the name has no usable letters', async () => {
    const { result } = renderHook(() => useSettingsController({ initials: 'PT', displayName: '' }))
    await act(async () => {})
    expect(result.current.initials).toBe('PT')
  })

  it('persists the name, pushes it to the nav, and reports success', async () => {
    const { result } = await mounted()

    let ok: boolean | undefined
    await act(async () => { ok = await result.current.saveProfile('Minh Phuong') })

    expect(ok).toBe(true)
    expect(updateUserMock).toHaveBeenCalledWith({ data: { display_name: 'Minh Phuong' } })
    expect(setUserNameMock).toHaveBeenCalledWith('Minh Phuong')
    expect(result.current.displayName).toBe('Minh Phuong')
    expect(result.current.initials).toBe('MP')
  })

  it('reports failure and leaves the name untouched when the update errors', async () => {
    updateUserMock.mockResolvedValueOnce({ data: { user: null }, error: { message: 'nope' } })
    const { result } = await mounted()

    let ok: boolean | undefined
    await act(async () => { ok = await result.current.saveProfile('Broken') })

    // The views key their "Saved" flash off this boolean — reporting success on
    // a failed write would close the form over an unsaved name.
    expect(ok).toBe(false)
    expect(toastErrorMock).toHaveBeenCalled()
    expect(result.current.displayName).toBe('Phuong')
    expect(setUserNameMock).not.toHaveBeenCalled()
  })
})

// ─── Price sync ──────────────────────────────────────────────────────────────

describe('useSettingsController — price sync', () => {
  it('reports success and advances the last-sync time', async () => {
    refreshPricesMock.mockResolvedValue({ ok: true })
    const { result } = await mounted()

    await act(async () => { await result.current.runSync() })

    expect(result.current.syncStatus).toBe('done')
    expect(result.current.syncStatusLabel).toBe('syncUpdated')
    expect(result.current.syncStatusColor).toBe('var(--c-pos)')
    expect(result.current.lastSyncIso).not.toBeNull()
  })

  it('treats a partial sync as neutral but still advances the timestamp', async () => {
    // Prices did move, just not all of them — nothing is broken.
    refreshPricesMock.mockResolvedValue({ ok: true, partial: true })
    const { result } = await mounted()

    await act(async () => { await result.current.runSync() })

    expect(result.current.syncStatus).toBe('partial')
    expect(result.current.syncStatusLabel).toBe('syncPartial')
    expect(result.current.syncStatusColor).toBe('var(--c-muted)')
    expect(result.current.lastSyncIso).not.toBeNull()
  })

  it('distinguishes rate limiting from a failure and does not advance the timestamp', async () => {
    refreshPricesMock.mockResolvedValue({ ok: false, reason: 'rate-limited', retryAfterSeconds: 42 })
    const { result } = await mounted()

    await act(async () => { await result.current.runSync() })

    expect(result.current.syncStatus).toBe('limited')
    expect(result.current.syncStatusLabel).toBe('syncRateLimited')
    // Neutral, not negative: the user just has to wait.
    expect(result.current.syncStatusColor).toBe('var(--c-muted)')
    expect(result.current.lastSyncIso).toBeNull()
  })

  it('reports a failure without advancing the timestamp', async () => {
    refreshPricesMock.mockResolvedValue({ ok: false, reason: 'error' })
    const { result } = await mounted()

    await act(async () => { await result.current.runSync() })

    expect(result.current.syncStatus).toBe('failed')
    expect(result.current.syncStatusLabel).toBe('syncFailed')
    expect(result.current.syncStatusColor).toBe('var(--c-neg)')
    expect(result.current.lastSyncIso).toBeNull()
  })

  it('shows the in-flight state while the refresh is running', async () => {
    let settle!: (r: { ok: true }) => void
    refreshPricesMock.mockImplementation(() => new Promise(res => { settle = res }))
    const { result } = await mounted()

    let done!: Promise<void>
    await act(async () => { done = result.current.runSync() })
    expect(result.current.syncStatus).toBe('syncing')
    expect(result.current.syncStatusLabel).toBe('syncUpdating')

    await act(async () => { settle({ ok: true }); await done })
    expect(result.current.syncStatus).toBe('done')
  })

  it('returns to the last-synced label after the status flash expires', async () => {
    vi.useFakeTimers()
    refreshPricesMock.mockResolvedValue({ ok: true })
    const { result } = renderHook(() => useSettingsController(PROPS))
    await act(async () => {})

    await act(async () => { await result.current.runSync() })
    expect(result.current.syncStatus).toBe('done')

    await act(async () => { vi.advanceTimersByTime(3000) })
    expect(result.current.syncStatus).toBe('idle')
    expect(result.current.syncStatusLabel).toContain('lastSyncedPrefix')
  })

  it('does not let a stale flash reset clobber a sync that started in the meantime', async () => {
    vi.useFakeTimers()
    refreshPricesMock.mockResolvedValue({ ok: false, reason: 'error' })
    const { result } = renderHook(() => useSettingsController(PROPS))
    await act(async () => {})

    await act(async () => { await result.current.runSync() })

    // Second sync starts before the first flash's 3s reset lands. If that reset
    // still fired blind it would drop the button out of its disabled state
    // while a request is genuinely in flight.
    let settle!: (r: { ok: true }) => void
    refreshPricesMock.mockImplementation(() => new Promise(res => { settle = res }))
    let done!: Promise<void>
    await act(async () => { done = result.current.runSync() })

    await act(async () => { vi.advanceTimersByTime(3000) })
    expect(result.current.syncStatus).toBe('syncing')

    await act(async () => { settle({ ok: true }); await done })
    expect(result.current.syncStatus).toBe('done')
  })

  it('clears its flash timer on unmount so a late reset never fires', async () => {
    vi.useFakeTimers()
    refreshPricesMock.mockResolvedValue({ ok: true })
    const { result, unmount } = renderHook(() => useSettingsController(PROPS))
    await act(async () => {})

    await act(async () => { await result.current.runSync() })
    unmount()

    // Desktop used a bare setTimeout here, so navigating away mid-flash left a
    // setState pointed at a torn-down tree.
    expect(() => act(() => { vi.advanceTimersByTime(3000) })).not.toThrow()
  })

  it('loads the last-sync time on mount', async () => {
    fetchLastSyncMock.mockResolvedValue('2026-07-29T00:00:00.000Z')
    const { result } = await mounted()

    expect(fetchLastSyncMock).toHaveBeenCalled()
    expect(result.current.lastSyncIso).toBe('2026-07-29T00:00:00.000Z')
  })
})

// ─── Language ────────────────────────────────────────────────────────────────

describe('useSettingsController — language', () => {
  it('writes the locale cookie and refreshes the route', async () => {
    const { result } = await mounted()

    act(() => { result.current.switchLocale('vi') })

    expect(setLocaleCookieMock).toHaveBeenCalledWith('vi')
    expect(refreshMock).toHaveBeenCalled()
  })
})

// ─── Appearance ──────────────────────────────────────────────────────────────

describe('useSettingsController — appearance', () => {
  it('hydrates the persisted choice after mount', async () => {
    localStorage.setItem('theme', 'dark')
    const { result } = await mounted()
    expect(result.current.themeChoice).toBe('dark')
  })

  it("treats the absence of a stored value as 'system'", async () => {
    const { result } = await mounted()
    expect(result.current.themeChoice).toBe('system')
  })

  it('applies a choice to the theme provider and to its own state', async () => {
    const { result } = await mounted()

    act(() => { result.current.selectTheme('dark') })

    expect(setThemeMock).toHaveBeenCalledWith('dark')
    expect(result.current.themeChoice).toBe('dark')
  })
})

// ─── Report export ───────────────────────────────────────────────────────────

const OVERVIEW = {
  netWorth: { netWorth: 100_000_000, currentValue: 95_000_000, overallProfitLoss: 5_000_000 },
  goals: [{ id: '1' }, { id: '2' }],
}

describe('useSettingsController — report', () => {
  it('opens the sheet and prefetches the overview summary', async () => {
    fetchOverviewMock.mockResolvedValue(OVERVIEW)
    const { result } = await mounted()

    await act(async () => { result.current.openReport() })

    expect(result.current.showReport).toBe(true)
    expect(result.current.reportSummary).toEqual({
      netWorth: 100_000_000,
      currentValue: 95_000_000,
      totalPL: 5_000_000,
      goalCount: 2,
    })
  })

  it('still opens the sheet when the prefetch fails', async () => {
    fetchOverviewMock.mockResolvedValue(null)
    const { result } = await mounted()

    await act(async () => { result.current.openReport() })

    // The export path re-fetches and surfaces its own error, so a failed
    // prefetch must not block the sheet.
    expect(result.current.showReport).toBe(true)
    expect(result.current.reportSummary).toBeNull()
  })

  // The prefetched overview feeds the sheet's KPI summary only. It is not part
  // of the export any more: the endpoint builds the PDF from the caller's own
  // holdings, so the locale is all that travels with the request (#594).
  it('exports with the active locale alone', async () => {
    fetchOverviewMock.mockResolvedValue(OVERVIEW)
    const { result } = await mounted()

    await act(async () => { result.current.openReport() })
    await act(async () => { await result.current.exportReport() })

    expect(exportReportMock).toHaveBeenCalledWith('en')
  })

  it('closes the sheet', async () => {
    const { result } = await mounted()
    await act(async () => { result.current.openReport() })
    act(() => { result.current.closeReport() })
    expect(result.current.showReport).toBe(false)
  })
})

// ─── Sign out ────────────────────────────────────────────────────────────────

describe('useSettingsController — sign out', () => {
  it('clears this account\'s caches before leaving for the login page', async () => {
    const { result } = await mounted()

    await act(async () => { await result.current.signOut() })

    expect(signOutMock).toHaveBeenCalled()
    expect(clearAppCachesMock).toHaveBeenCalled()
    expect(pushMock).toHaveBeenCalledWith('/auth/login')
  })

  it('keeps the user in place and reports the error when sign-out fails', async () => {
    signOutMock.mockResolvedValueOnce({ error: { message: 'nope' } })
    const { result } = await mounted()

    await act(async () => { await result.current.signOut() })

    // Clearing caches on a failed sign-out would log the user out locally while
    // the session is still live on the server.
    expect(toastErrorMock).toHaveBeenCalled()
    expect(clearAppCachesMock).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })
})
