import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DesktopSettingsView from '../DesktopSettingsView'

// Mirrors the MobileSettingsView test setup so both views are covered by fast
// component tests rather than duplicated desktop+mobile E2E (see the e2e
// consolidation: only the real round-trips — save→sidebar, Sync→cron — stay E2E).

const { signOutMock, updateUserMock, setUserNameMock, toastErrorMock } = vi.hoisted(() => ({
  signOutMock: vi.fn().mockResolvedValue({ error: null }),
  updateUserMock: vi.fn().mockResolvedValue({ data: { user: {} }, error: null }),
  setUserNameMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

// Resolve real English copy from the message catalog so assertions check the
// rendered, localized text.
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

// ─── Page header ─────────────────────────────────────────────────────────────────

describe('DesktopSettingsView — page header', () => {
  it('renders the Preferences heading', () => {
    render(<DesktopSettingsView {...defaultProps} />)
    expect(screen.getByRole('heading', { name: 'Preferences' })).toBeInTheDocument()
  })

  it('renders the Settings eyebrow/subtitle', () => {
    render(<DesktopSettingsView {...defaultProps} />)
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })
})

// ─── Profile card ────────────────────────────────────────────────────────────────

describe('DesktopSettingsView — profile card', () => {
  it('renders user display name, email and initials', () => {
    render(<DesktopSettingsView {...defaultProps} />)
    expect(screen.getByText('Phuong')).toBeInTheDocument()
    expect(screen.getByText('phuong.tran@example.com')).toBeInTheDocument()
    // 'Phuong' → single word → 'P'
    expect(screen.getByText('P')).toBeInTheDocument()
  })

  it('renders an Edit button on the profile card', () => {
    render(<DesktopSettingsView {...defaultProps} />)
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
  })
})

// ─── Profile modal ───────────────────────────────────────────────────────────────

describe('DesktopSettingsView — profile modal', () => {
  it('opens a dialog with name and email prefilled when Edit is clicked', async () => {
    render(<DesktopSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Phuong')).toBeInTheDocument()
    expect(screen.getByDisplayValue('phuong.tran@example.com')).toBeInTheDocument()
  })

  it('closes the dialog when Cancel is clicked', async () => {
    render(<DesktopSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }))
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('updates the profile card name and initials after saving', async () => {
    render(<DesktopSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }))
    const nameInput = screen.getByDisplayValue('Phuong')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Minh Phuong')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    // After the success flash + close, the card shows the new name + 'MP' initials.
    await waitFor(() => expect(screen.getByText('Minh Phuong')).toBeInTheDocument(), { timeout: 2000 })
    expect(screen.getByText('MP')).toBeInTheDocument()
  })

  it('persists the display name to Supabase and pushes it to NavigationContext', async () => {
    updateUserMock.mockClear()
    setUserNameMock.mockClear()
    // Without the NavigationContext push the desktop sidebar avatar/name stays
    // stale until a page refresh — this is the propagation the E2E guards too.
    render(<DesktopSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }))
    const nameInput = screen.getByDisplayValue('Phuong')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Minh')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(updateUserMock).toHaveBeenCalledWith({ data: { display_name: 'Minh' } }))
    expect(setUserNameMock).toHaveBeenCalledWith('Minh')
  })

  it('surfaces a toast and keeps the modal open when the update fails', async () => {
    toastErrorMock.mockClear()
    updateUserMock.mockResolvedValueOnce({ data: { user: null }, error: { message: 'nope' } })
    render(<DesktopSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }))
    const nameInput = screen.getByDisplayValue('Phuong')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Broken')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled())
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('Broken')).toBeInTheDocument()
  })
})

// ─── Preferences — Language & Appearance ─────────────────────────────────────────

describe('DesktopSettingsView — preferences', () => {
  it('renders the Language label and English / Tiếng Việt pills', () => {
    render(<DesktopSettingsView {...defaultProps} />)
    expect(screen.getByText('Language')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'English' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tiếng Việt' })).toBeInTheDocument()
  })

  it('renders the Appearance label and Light / Dark / System pills', () => {
    render(<DesktopSettingsView {...defaultProps} />)
    expect(screen.getByText('Appearance')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^light$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^dark$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^system$/i })).toBeInTheDocument()
  })

  it('does not render any Currency control (removed — it was a dead control)', () => {
    render(<DesktopSettingsView {...defaultProps} />)
    for (const code of ['VND', 'USD', 'EUR']) {
      expect(screen.queryByRole('button', { name: code })).not.toBeInTheDocument()
    }
  })
})

// ─── Price sync section ──────────────────────────────────────────────────────────

describe('DesktopSettingsView — price sync', () => {
  it('renders the Price sync heading, Sync now button and Fund NAV / Gold price rows', () => {
    render(<DesktopSettingsView {...defaultProps} />)
    expect(screen.getByText('Price sync')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sync now/i })).toBeInTheDocument()
    expect(screen.getByText(/fund nav/i)).toBeInTheDocument()
    expect(screen.getByText(/gold price/i)).toBeInTheDocument()
  })

  it('calls the sync API when Sync now is clicked', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    )
    render(<DesktopSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /sync now/i }))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    fetchSpy.mockRestore()
  })

  it('disables the Sync now button while syncing', async () => {
    let resolve!: () => void
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise(res => { resolve = () => res(new Response('{}', { status: 200 })) })
    )
    render(<DesktopSettingsView {...defaultProps} />)
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
    render(<DesktopSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /sync now/i }))
    await waitFor(() => expect(screen.getByText(/sync failed/i)).toBeInTheDocument())
    expect(screen.queryByText(/updated/i)).not.toBeInTheDocument()
    fetchSpy.mockRestore()
  })
})

// ─── Data / Export section ───────────────────────────────────────────────────────

const mockOverviewResponse = {
  netWorth: { netWorth: 100_000_000, currentValue: 95_000_000, overallProfitLoss: 5_000_000 },
  goals: [{ id: '1' }, { id: '2' }],
  unallocated: { totalValue: 0, funds: [], nonFunds: [] },
  byType: { bank: 0, gold: 0, stock: 0 },
  insurance: [],
}

describe('DesktopSettingsView — data section', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify(mockOverviewResponse), { status: 200 })
    )
  })
  afterEach(() => fetchSpy.mockRestore())

  it('renders the Data heading and Export data row', () => {
    render(<DesktopSettingsView {...defaultProps} />)
    expect(screen.getByText(/^data$/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export data/i })).toBeInTheDocument()
  })

  it('opens the download report sheet when Export data is clicked', async () => {
    render(<DesktopSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /export data/i }))
    expect(screen.getByText(/portfolio report/i)).toBeInTheDocument()
  })
})

// ─── Sign out ────────────────────────────────────────────────────────────────────

describe('DesktopSettingsView — sign out', () => {
  it('renders the Sign out button', () => {
    render(<DesktopSettingsView {...defaultProps} />)
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  it('calls supabase signOut when Sign out is clicked', async () => {
    signOutMock.mockClear()
    render(<DesktopSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }))
    await waitFor(() => expect(signOutMock).toHaveBeenCalled())
  })
})

// ─── Version text ────────────────────────────────────────────────────────────────

describe('DesktopSettingsView — version text', () => {
  it('renders version info', () => {
    render(<DesktopSettingsView {...defaultProps} />)
    expect(screen.getByText(/v\d/i)).toBeInTheDocument()
  })
})
