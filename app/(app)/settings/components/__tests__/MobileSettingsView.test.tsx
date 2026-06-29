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
    // Both fetches resolve not-ok → refreshPrices returns false.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 500 })
    )
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /sync now/i }))
    await waitFor(() => expect(screen.getByText(/sync failed/i)).toBeInTheDocument())
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
