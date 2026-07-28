import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MobileSettingsView from '../MobileSettingsView'

const { signOutMock, updateUserMock, setUserNameMock, toastErrorMock } = vi.hoisted(() => ({
  signOutMock: vi.fn().mockResolvedValue({ error: null }),
  updateUserMock: vi.fn().mockResolvedValue({ data: { user: {} }, error: null }),
  setUserNameMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

// Resolve real English copy from the message catalog so assertions check the
// rendered, localized text (the view was migrated from `isVI ? …` to `t()`).
vi.mock('next-intl', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const en = require('../../../../../messages/en.json')
  const resolve = (ns: string | undefined, key: string) => {
    const dict = ns ? en[ns] : en
    return key.split('.').reduce((o: Record<string, unknown> | undefined, k: string) =>
      (o == null ? undefined : o[k] as Record<string, unknown>), dict) ?? key
  }
  return {
    useTranslations: (ns?: string) => (key: string) => resolve(ns, key),
    useLocale: () => 'en',
  }
})

vi.mock('sonner', () => ({
  toast: { error: toastErrorMock, success: vi.fn() },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useTransition: () => [false, (fn: () => void) => fn()],
}))

vi.mock('@/app/components/navigation/NavigationContext', () => ({
  useNavigation: () => ({ setMobileTopBar: vi.fn(), setUserName: setUserNameMock }),
}))

vi.mock('@/app/components/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn(), setTheme: vi.fn() }),
}))

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: () => ({
    auth: { signOut: signOutMock, updateUser: updateUserMock },
  }),
}))

const defaultProps = {
  email: 'phuong.tran@example.com',
  initials: 'PT',
  displayName: 'Phuong',
}

// ─── Profile card ──────────────────────────────────────────────────────────────

describe('MobileSettingsView — profile card', () => {
  it('renders user display name', () => {
    render(<MobileSettingsView {...defaultProps} />)
    expect(screen.getByText('Phuong')).toBeInTheDocument()
  })

  it('renders user email', () => {
    render(<MobileSettingsView {...defaultProps} />)
    expect(screen.getByText('phuong.tran@example.com')).toBeInTheDocument()
  })

  it('renders user initials derived from display name', () => {
    render(<MobileSettingsView {...defaultProps} />)
    // 'Phuong' → single word → 'P'
    expect(screen.getByText('P')).toBeInTheDocument()
  })

  it('updates avatar initials after saving a new display name', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /profile/i }))
    const nameInput = screen.getByDisplayValue('Phuong')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Minh Phuong')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(screen.getByText('MP')).toBeInTheDocument(), { timeout: 2000 })
  })

  it('opens profile sheet when profile card is clicked', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /profile/i }))
    expect(screen.getByText(/profile/i)).toBeInTheDocument()
  })
})

// ─── Profile sheet ─────────────────────────────────────────────────────────────

describe('MobileSettingsView — profile sheet', () => {
  it('shows name input prefilled with displayName', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /profile/i }))
    const nameInput = screen.getByDisplayValue('Phuong')
    expect(nameInput).toBeInTheDocument()
  })

  it('shows email input prefilled with email', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /profile/i }))
    const emailInput = screen.getByDisplayValue('phuong.tran@example.com')
    expect(emailInput).toBeInTheDocument()
  })

  it('updates profile card name after saving', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /profile/i }))
    const nameInput = screen.getByDisplayValue('Phuong')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Minh')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    // After the success flash + close, the profile card should show the new name
    await waitFor(() => expect(screen.getByText('Minh')).toBeInTheDocument(), { timeout: 2000 })
    expect(screen.queryByText('Phuong')).not.toBeInTheDocument()
  })

  it('closes profile sheet when cancel is clicked', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /profile/i }))
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    await waitFor(() =>
      expect(screen.queryByDisplayValue('phuong.tran@example.com')).not.toBeInTheDocument()
    )
  })

  it('persists display name to Supabase when saving', async () => {
    updateUserMock.mockClear()
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /profile/i }))
    const nameInput = screen.getByDisplayValue('Phuong')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Minh')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() =>
      expect(updateUserMock).toHaveBeenCalledWith({ data: { display_name: 'Minh' } })
    )
  })

  it('pushes the new name to NavigationContext so the sidebar updates immediately', async () => {
    // Without this, the sidebar avatar/name stays stale until the user
    // refreshes the page, because the sidebar reads from NavigationContext
    // rather than from the settings view's local state.
    setUserNameMock.mockClear()
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /profile/i }))
    const nameInput = screen.getByDisplayValue('Phuong')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Minh Phuong')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(setUserNameMock).toHaveBeenCalledWith('Minh Phuong'))
  })
})

// ─── iOS auto-zoom guard (issue #265) ──────────────────────────────────────────
// iOS Safari zooms the page when a focused native field has font-size < 16px and
// never resets it. Every field must render at >= 16px on mobile.

describe('MobileSettingsView — iOS zoom guard (issue #265)', () => {
  it('renders the profile name and email inputs at >=16px', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /profile/i }))
    const nameInput = screen.getByDisplayValue('Phuong')
    const emailInput = screen.getByDisplayValue('phuong.tran@example.com')
    for (const el of [nameInput, emailInput]) {
      expect(parseFloat(getComputedStyle(el).fontSize)).toBeGreaterThanOrEqual(16)
    }
  })
})

// ─── Preferences section ───────────────────────────────────────────────────────

describe('MobileSettingsView — preferences section', () => {
  it('renders Preferences section heading', () => {
    render(<MobileSettingsView {...defaultProps} />)
    expect(screen.getAllByText(/preferences/i).length).toBeGreaterThan(0)
  })

  it('renders Language row', () => {
    render(<MobileSettingsView {...defaultProps} />)
    expect(screen.getByText(/language/i)).toBeInTheDocument()
  })

  it('shows current locale value on language row', () => {
    render(<MobileSettingsView {...defaultProps} />)
    expect(screen.getByText('English')).toBeInTheDocument()
  })

  it('renders Appearance row', () => {
    render(<MobileSettingsView {...defaultProps} />)
    expect(screen.getByText(/appearance/i)).toBeInTheDocument()
  })

  it('does not render a Currency row (removed — it was a dead control)', () => {
    render(<MobileSettingsView {...defaultProps} />)
    expect(screen.queryByText(/currency/i)).not.toBeInTheDocument()
  })
})

// ─── Appearance sheet ──────────────────────────────────────────────────────────

describe('MobileSettingsView — appearance sheet', () => {
  it('opens appearance sheet when Appearance row is clicked', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /appearance/i }))
    // Apply button only exists inside the AppearanceSheet — its presence confirms the sheet opened
    expect(screen.getByRole('button', { name: /apply/i })).toBeInTheDocument()
  })

  it('shows Light, Dark and System options in the appearance sheet', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /appearance/i }))
    // The current-theme value also renders these labels, so match ≥1 occurrence.
    expect(screen.getAllByText(/^light$/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/^dark$/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/^system$/i).length).toBeGreaterThan(0)
  })

  it('closes appearance sheet when apply is clicked', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /appearance/i }))
    await userEvent.click(screen.getByRole('button', { name: /apply/i }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /apply/i })).not.toBeInTheDocument()
    )
  })
})

// ─── Profile save failure (#5) ──────────────────────────────────────────────────

describe('MobileSettingsView — profile save failure', () => {
  it('surfaces a toast and keeps the form open when the update fails', async () => {
    toastErrorMock.mockClear()
    // One failing update; the shared default (resolves error: null) is restored
    // for the next call automatically.
    updateUserMock.mockResolvedValueOnce({ data: { user: null }, error: { message: 'nope' } })
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /profile/i }))
    const nameInput = screen.getByDisplayValue('Phuong')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Broken')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled())
    // No success flash, and the form is still editable (not closed).
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('Broken')).toBeInTheDocument()
  })
})

const mockOverviewResponse = {
  netWorth: { netWorth: 100_000_000, currentValue: 95_000_000, overallProfitLoss: 5_000_000 },
  goals: [{ id: '1' }, { id: '2' }],
  unallocated: { totalValue: 0, funds: [], nonFunds: [] },
  byType: { bank: 0, gold: 0, stock: 0 },
  insurance: [],
}

// ─── Data section ──────────────────────────────────────────────────────────────

describe('MobileSettingsView — data section', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Fresh Response per call: the component also fetches the last-sync time on
    // mount, and a Response body can only be read once.
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify(mockOverviewResponse), { status: 200 })
    )
  })
  afterEach(() => fetchSpy.mockRestore())

  it('renders Data section heading', () => {
    render(<MobileSettingsView {...defaultProps} />)
    expect(screen.getByText(/^data$/i)).toBeInTheDocument()
  })

  it('renders Export data row', () => {
    render(<MobileSettingsView {...defaultProps} />)
    expect(screen.getByText(/export data/i)).toBeInTheDocument()
  })

  it('opens download report sheet when Export data is clicked', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /export data/i }))
    expect(screen.getByText(/portfolio report/i)).toBeInTheDocument()
  })

  it('offers a single PDF export button and no dead CSV picker', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /export data/i }))
    expect(screen.getByRole('button', { name: /export report/i })).toBeInTheDocument()
    // The CSV option was a dead control (always exported PDF) and was removed.
    expect(screen.queryByRole('button', { name: /^csv$/i })).not.toBeInTheDocument()
  })

  it('shows KPI data in report sheet after fetch', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /export data/i }))
    await waitFor(() => expect(screen.getByText('Net worth')).toBeInTheDocument())
    expect(screen.getByText('Current value')).toBeInTheDocument()
  })

  it('closes download report sheet when backdrop is clicked', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /export data/i }))
    expect(screen.getByText(/portfolio report/i)).toBeInTheDocument()
    const backdrop = document.querySelector('[style*="position: fixed"][style*="inset: 0"]') as HTMLElement
    if (backdrop) fireEvent.click(backdrop)
    await waitFor(() =>
      expect(screen.queryByText(/portfolio report/i)).not.toBeInTheDocument()
    )
  })
})

// ─── Price sync section ────────────────────────────────────────────────────────

describe('MobileSettingsView — price sync section', () => {
  it('renders Price sync section heading', () => {
    render(<MobileSettingsView {...defaultProps} />)
    expect(screen.getByText(/price sync/i)).toBeInTheDocument()
  })

  it('renders Fund NAV row', () => {
    render(<MobileSettingsView {...defaultProps} />)
    expect(screen.getByText(/fund nav/i)).toBeInTheDocument()
  })

  it('renders Gold price row', () => {
    render(<MobileSettingsView {...defaultProps} />)
    expect(screen.getByText(/gold price/i)).toBeInTheDocument()
  })

  it('renders Sync now button', () => {
    render(<MobileSettingsView {...defaultProps} />)
    expect(screen.getByRole('button', { name: /sync now/i })).toBeInTheDocument()
  })

  it('shows last synced time', () => {
    render(<MobileSettingsView {...defaultProps} />)
    expect(screen.getByText(/last synced/i)).toBeInTheDocument()
  })

  it('calls sync API when Sync now is clicked', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    )
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /sync now/i }))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    fetchSpy.mockRestore()
  })

  it('disables Sync now button while syncing', async () => {
    let resolve!: () => void
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise(res => { resolve = () => res(new Response('{}', { status: 200 })) })
    )
    render(<MobileSettingsView {...defaultProps} />)
    const btn = screen.getByRole('button', { name: /sync now/i })
    await userEvent.click(btn)
    expect(btn).toBeDisabled()
    resolve()
    fetchSpy.mockRestore()
  })

  it('shows a failure status (not "Updated") when a refresh endpoint errors', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 500 })
    )
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /sync now/i }))
    await waitFor(() => expect(screen.getByText(/sync failed/i)).toBeInTheDocument())
    expect(screen.queryByText(/updated/i)).not.toBeInTheDocument()
    fetchSpy.mockRestore()
  })

  // The success path was never asserted here, which is how #552 survived: the
  // button had reported "Sync failed" for every user since it was wired to the
  // cron routes, and only the failure branch was covered.
  it('shows "Updated" when both refreshes succeed', async () => {
    // refresh-nav's body matters: it answers 200 even when every fund failed, so
    // the helper reads `results` to tell a real sync from an empty one.
    //
    // mockImplementation, not mockResolvedValue: a Response body can only be
    // read once, and the mount-time fetchLastSync would otherwise consume the
    // single shared instance before refreshPrices could parse it.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ results: [{ id: 'f1', nav: 10000 }] }), { status: 200 })
    )
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /sync now/i }))
    await waitFor(() => expect(screen.getByText(/updated/i)).toBeInTheDocument())
    expect(screen.queryByText(/sync failed/i)).not.toBeInTheDocument()
    fetchSpy.mockRestore()
  })

  it('cleans the success-status timer when the view unmounts', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ results: [{ id: 'f1', nav: 10000 }] }), { status: 200 })
    )
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const { unmount } = render(<MobileSettingsView {...defaultProps} />)

    await userEvent.click(screen.getByRole('button', { name: /sync now/i }))
    await waitFor(() => expect(screen.getByText(/updated/i)).toBeInTheDocument())
    unmount()

    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore()
    fetchSpy.mockRestore()
  })

  it('calls the user-scoped endpoints rather than the cron routes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ results: [{ id: 'f1', nav: 10000 }] }), { status: 200 })
    )
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /sync now/i }))
    await waitFor(() => expect(screen.getByText(/updated/i)).toBeInTheDocument())
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]))
    expect(urls).toEqual(expect.arrayContaining([
      '/api/v1/funds/refresh-nav',
      '/api/v1/gold-price/refresh',
    ]))
    expect(urls.some((u) => u.includes('/api/cron/'))).toBe(false)
    fetchSpy.mockRestore()
  })

  // Gold moved but the funds didn't. "Updated" would hide the stale NAVs and
  // "Sync failed" would deny the price that did change.
  it('reports a partial sync when some prices failed', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      String(url).includes('refresh-nav')
        ? new Response(JSON.stringify({ results: [{ id: 'f1', error: 'Provider timeout' }] }), { status: 200 })
        : new Response(JSON.stringify({ price_per_chi: 8500000 }), { status: 200 })
    )
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /sync now/i }))
    await waitFor(() => expect(screen.getByText(/partly updated/i)).toBeInTheDocument())
    expect(screen.queryByText(/sync failed/i)).not.toBeInTheDocument()
    fetchSpy.mockRestore()
  })

  // "Sync failed" would send the user looking for a broken app; the real
  // instruction is to wait a moment.
  it('distinguishes a rate-limited sync from a failure', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 429, headers: { 'Retry-After': '30' } })
    )
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /sync now/i }))
    await waitFor(() => expect(screen.getByText(/too many|wait/i)).toBeInTheDocument())
    expect(screen.queryByText(/sync failed/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/updated/i)).not.toBeInTheDocument()
    fetchSpy.mockRestore()
  })
})

// ─── Sign out ──────────────────────────────────────────────────────────────────

describe('MobileSettingsView — sign out', () => {
  it('renders Sign out button', () => {
    render(<MobileSettingsView {...defaultProps} />)
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  it('calls supabase signOut when Sign out is clicked', async () => {
    signOutMock.mockClear()
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }))
    await waitFor(() => expect(signOutMock).toHaveBeenCalled())
  })
})

// ─── Version text ──────────────────────────────────────────────────────────────

describe('MobileSettingsView — version text', () => {
  it('renders version info', () => {
    render(<MobileSettingsView {...defaultProps} />)
    expect(screen.getByText(/v\d/i)).toBeInTheDocument()
  })
})

// ─── Dialog a11y (parity with the Plan page's useDialogA11y) ─────────────────────
// The bottom sheets must close on Escape and expose themselves as a labelled
// dialog, matching the keyboard/screen-reader behaviour the rest of the app
// standardized on. Without this, a keyboard user has no non-pointer way out.

describe('MobileSettingsView — dialog a11y', () => {
  it('closes the profile sheet on Escape', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /profile/i }))
    expect(screen.getByDisplayValue('phuong.tran@example.com')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByDisplayValue('phuong.tran@example.com')).not.toBeInTheDocument()
    )
  })

  it('closes the appearance sheet on Escape', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /appearance/i }))
    expect(screen.getByRole('button', { name: /apply/i })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /apply/i })).not.toBeInTheDocument()
    )
  })

  it('exposes the open sheet as a labelled dialog', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /profile/i }))
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/profile/i)
  })
})

// ─── Mobile touch targets (≥44px — WCAG 2.5.5, parity with #410/#413/#416) ───────
// On a phone these are the primary actions. They previously sat at ~31–42px
// (small padding + 12–13px text), below the 44px minimum hit area. Assert the
// inline minHeight floor (jsdom does no layout, so the style is the contract).

describe('MobileSettingsView — touch targets (≥44px)', () => {
  it('gives the Sync now button a ≥44px touch target', () => {
    render(<MobileSettingsView {...defaultProps} />)
    expect(screen.getByRole('button', { name: /sync now/i })).toHaveStyle({ minHeight: '44px' })
  })

  it('gives the Sign out button a ≥44px touch target', () => {
    render(<MobileSettingsView {...defaultProps} />)
    expect(screen.getByRole('button', { name: /sign out/i })).toHaveStyle({ minHeight: '44px' })
  })

  it('gives the profile sheet Save and Cancel buttons a ≥44px touch target', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /profile/i }))
    expect(screen.getByRole('button', { name: /save/i })).toHaveStyle({ minHeight: '44px' })
    expect(screen.getByRole('button', { name: /cancel/i })).toHaveStyle({ minHeight: '44px' })
  })

  it('gives the appearance sheet Apply button a ≥44px touch target', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /appearance/i }))
    expect(screen.getByRole('button', { name: /apply/i })).toHaveStyle({ minHeight: '44px' })
  })
})

describe('MobileSettingsView — export sheet touch targets (≥44px)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify(mockOverviewResponse), { status: 200 })
    )
  })
  afterEach(() => fetchSpy.mockRestore())

  it('gives the Export and Cancel buttons a ≥44px touch target', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /export data/i }))
    expect(screen.getByTestId('export-report-btn')).toHaveStyle({ minHeight: '44px' })
    expect(screen.getByRole('button', { name: /^cancel$/i })).toHaveStyle({ minHeight: '44px' })
  })

  it('gives the close button a ≥44px square touch target', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /export data/i }))
    expect(screen.getByRole('button', { name: /^close$/i }))
      .toHaveStyle({ minWidth: '44px', minHeight: '44px' })
  })
})

// ─── Language chooser (honest chevron) ───────────────────────────────────────────
// The Language row carries a chevron — the same affordance as Appearance, which
// opens a chooser. It must actually open a chooser sheet (explicit select +
// Apply), not silently flip en↔vi on tap. Tapping a row that looks like it opens
// a picker but instead mutates state is a dishonest affordance.

describe('MobileSettingsView — language chooser', () => {
  it('opens a labelled chooser sheet with both languages instead of toggling', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /language/i }))
    // Same pattern as Appearance: a labelled dialog with the options + Apply.
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/language/i)
    expect(screen.getByRole('button', { name: 'English' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tiếng Việt' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /apply/i })).toBeInTheDocument()
  })

  it('persists the chosen locale only after Apply (not on row tap or select)', async () => {
    // Clear any locale cookie left by a prior test so the assertions are clean.
    document.cookie = 'locale=;path=/;max-age=0'
    render(<MobileSettingsView {...defaultProps} />)

    // Opening the row alone must not switch the locale…
    await userEvent.click(screen.getByRole('button', { name: /language/i }))
    expect(document.cookie).not.toContain('locale=vi')

    // …nor does merely selecting an option…
    await userEvent.click(screen.getByRole('button', { name: 'Tiếng Việt' }))
    expect(document.cookie).not.toContain('locale=vi')

    // …only Apply persists the chosen locale.
    await userEvent.click(screen.getByRole('button', { name: /apply/i }))
    expect(document.cookie).toContain('locale=vi')
  })

  it('gives the chooser options and Apply a ≥44px touch target', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /language/i }))
    expect(screen.getByRole('button', { name: 'English' })).toHaveStyle({ minHeight: '44px' })
    expect(screen.getByRole('button', { name: /apply/i })).toHaveStyle({ minHeight: '44px' })
  })
})

// ─── Cross-surface consistency (PR-4) ────────────────────────────────────────────

describe('MobileSettingsView — section order (matches desktop)', () => {
  it('places the Price sync section before Data', () => {
    render(<MobileSettingsView {...defaultProps} />)
    const priceSync = screen.getByText('Price sync')
    const data = screen.getByText(/^data$/i)
    // Desktop's right column is Price sync → Data; mobile should read the same.
    expect(priceSync.compareDocumentPosition(data) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy()
  })
})

describe('MobileSettingsView — profile form backdrop (no accidental data loss)', () => {
  it('does NOT close the profile sheet on a backdrop tap (avoids losing a typed name)', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /profile/i }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(dialog.parentElement as HTMLElement) // the backdrop
    // Wait past the BottomSheet's 220ms close animation: with backdrop-dismiss
    // disabled the sheet must still be mounted, not merely mid-close.
    await new Promise(r => setTimeout(r, 280))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('still closes the appearance sheet on a backdrop tap (no unsaved input there)', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /appearance/i }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(dialog.parentElement as HTMLElement)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

// ─── P3 polish ───────────────────────────────────────────────────────────────────

describe('MobileSettingsView — profile email hint', () => {
  it('explains that the read-only email cannot be changed', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /profile/i }))
    expect(screen.getByText(/email can't be changed/i)).toBeInTheDocument()
  })
})

describe('MobileSettingsView — export KPI loading state', () => {
  it('shows a KPI loading placeholder until the overview resolves', async () => {
    // Never-resolving fetch: the overview (and last-sync) stay pending, so the
    // report sheet must render a loading placeholder rather than an empty gap.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise(() => {}) as Promise<Response>
    )
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /export data/i }))
    expect(await screen.findByTestId('report-kpi-loading')).toBeInTheDocument()
    fetchSpy.mockRestore()
  })
})
