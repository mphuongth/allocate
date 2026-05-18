import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MobileSettingsView from '../MobileSettingsView'

const { signOutMock } = vi.hoisted(() => ({
  signOutMock: vi.fn().mockResolvedValue({ error: null }),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useTransition: () => [false, (fn: () => void) => fn()],
}))

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: () => ({
    auth: { signOut: signOutMock },
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

  it('renders user initials in avatar', () => {
    render(<MobileSettingsView {...defaultProps} />)
    expect(screen.getByText('PT')).toBeInTheDocument()
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

  it('renders Currency row', () => {
    render(<MobileSettingsView {...defaultProps} />)
    expect(screen.getByText(/currency/i)).toBeInTheDocument()
  })

  it('shows current currency value', () => {
    render(<MobileSettingsView {...defaultProps} />)
    expect(screen.getByText('VND')).toBeInTheDocument()
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

  it('closes appearance sheet when apply is clicked', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /appearance/i }))
    await userEvent.click(screen.getByRole('button', { name: /apply/i }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /apply/i })).not.toBeInTheDocument()
    )
  })
})

// ─── Currency sheet ────────────────────────────────────────────────────────────

describe('MobileSettingsView — currency sheet', () => {
  it('opens currency sheet when Currency row is clicked', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /^currency$/i }))
    expect(screen.getByText('Vietnamese Dong')).toBeInTheDocument()
    expect(screen.getByText('US Dollar')).toBeInTheDocument()
    expect(screen.getByText('Euro')).toBeInTheDocument()
  })

  it('closes currency sheet when apply is clicked', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /^currency$/i }))
    await userEvent.click(screen.getByRole('button', { name: /apply/i }))
    await waitFor(() =>
      expect(screen.queryByText('Vietnamese Dong')).not.toBeInTheDocument()
    )
  })
})

// ─── Data section ──────────────────────────────────────────────────────────────

describe('MobileSettingsView — data section', () => {
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

  it('closes download report sheet when backdrop is clicked', async () => {
    render(<MobileSettingsView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /export data/i }))
    expect(screen.getByText(/portfolio report/i)).toBeInTheDocument()
    // Click the backdrop (the fixed overlay div) to close
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
