import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DesktopFundLibraryView from '../DesktopFundLibraryView'
import type { Fund } from '../useFundsData'

// Presence/render + filter coverage for the desktop Funds table. Moved off E2E
// (each spun a browser, duplicated the mobile view) per the test-layering policy.
// next-intl is mocked to return the key (proves t() usage, not hardcoded English);
// a mutable locale lets one test assert the vi label path. fmtNav is lib-tested
// (lib/__tests__/formatters.test.ts), so it is mocked here.

const i18nState = vi.hoisted(() => ({ locale: 'en' }))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  useLocale: () => i18nState.locale,
}))

vi.mock('@/lib/formatters', () => ({
  fmtNav: (n: number) => String(n),
  fmtCompact: (n: number) => `${n}`,
}))

function makeFund(over: Partial<Fund> = {}): Fund {
  return {
    id: 'f1',
    name: 'VFMVF1 Equity Fund',
    code: 'VFMVF1',
    fund_type: 'equity',
    nav: 36120,
    nav_source_url: null,
    is_dca: false,
    dca_monthly_amount_vnd: null,
    dca_goal_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

function Harness({ initial }: { initial: Fund[] }) {
  const [funds, setFunds] = useState(initial)
  return (
    <DesktopFundLibraryView
      funds={funds}
      setFunds={setFunds}
      goals={[]}
      loading={false}
      error={false}
      reload={() => Promise.resolve()}
    />
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => {
  vi.unstubAllGlobals()
  i18nState.locale = 'en'
})

// ─── Toolbar ─────────────────────────────────────────────────────────────────

describe('DesktopFundLibraryView — toolbar', () => {
  it('shows search, the four type filter pills, refresh and add', () => {
    render(<Harness initial={[makeFund()]} />)
    const toolbar = within(screen.getByTestId('desktop-funds-toolbar'))
    expect(toolbar.getByPlaceholderText('searchPlaceholder')).toBeInTheDocument()
    for (const name of ['All', 'Stock', 'Bond', 'Balanced']) {
      expect(toolbar.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(toolbar.getByRole('button', { name: 'refresh' })).toBeInTheDocument()
    expect(toolbar.getByRole('button', { name: 'add' })).toBeInTheDocument()
  })
})

// ─── Table rows ──────────────────────────────────────────────────────────────

describe('DesktopFundLibraryView — table', () => {
  it('renders a row with code, type chip and NAV', () => {
    render(<Harness initial={[makeFund({ code: 'DTEQ01', nav: 55000 })]} />)
    const row = within(screen.getByTestId('fund-row-f1'))
    expect(row.getByText('DTEQ01')).toBeInTheDocument()
    expect(row.getByText('Stock')).toBeInTheDocument()
    expect(row.getByText('55000')).toBeInTheDocument() // fmtNav mocked; real format is lib-tested
  })

  it('shows per-fund NAV age when a source URL is set (#9)', () => {
    render(<Harness initial={[makeFund({ nav_source_url: 'https://example.com/nav' })]} />)
    const row = within(screen.getByTestId('fund-row-f1'))
    expect(row.getByText(/updatedAgo/)).toBeInTheDocument()
  })

  it('omits the NAV age line when no source URL is set', () => {
    render(<Harness initial={[makeFund({ nav_source_url: null })]} />)
    const row = within(screen.getByTestId('fund-row-f1'))
    expect(row.queryByText(/updatedAgo/)).not.toBeInTheDocument()
  })

  it('exposes localized edit/delete/DCA accessible names (uses t(), not hardcoded English)', () => {
    render(<Harness initial={[makeFund()]} />)
    const row = within(screen.getByTestId('fund-row-f1'))
    expect(row.getByRole('button', { name: 'editFund' })).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'deleteBtn' })).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'enableDca' })).toBeInTheDocument()
  })
})

// ─── Search + type filter ────────────────────────────────────────────────────

describe('DesktopFundLibraryView — search & type filter', () => {
  it('filters rows by code via the search box', async () => {
    render(<Harness initial={[makeFund({ id: 'a', code: 'AAAA' }), makeFund({ id: 'b', code: 'BBBB' })]} />)
    await userEvent.type(screen.getByPlaceholderText('searchPlaceholder'), 'AAAA')
    expect(screen.getByTestId('fund-row-a')).toBeInTheDocument()
    expect(screen.queryByTestId('fund-row-b')).not.toBeInTheDocument()
  })

  it('shows only matching funds when a type pill is selected', async () => {
    render(<Harness initial={[makeFund({ id: 'eq', fund_type: 'equity' }), makeFund({ id: 'bd', fund_type: 'debt' })]} />)
    const toolbar = within(screen.getByTestId('desktop-funds-toolbar'))
    await userEvent.click(toolbar.getByRole('button', { name: 'Stock' }))
    expect(screen.getByTestId('fund-row-eq')).toBeInTheDocument()
    expect(screen.queryByTestId('fund-row-bd')).not.toBeInTheDocument()
  })
})

// ─── Add / Edit / Delete modals ──────────────────────────────────────────────

describe('DesktopFundLibraryView — modals', () => {
  it('opens the add modal from the toolbar', async () => {
    render(<Harness initial={[makeFund()]} />)
    await userEvent.click(within(screen.getByTestId('desktop-funds-toolbar')).getByRole('button', { name: 'add' }))
    expect(screen.getByTestId('fund-modal')).toBeInTheDocument()
    expect(screen.getByTestId('fund-modal-title')).toHaveTextContent('addModal')
  })

  it('add modal type dropdown excludes gold, matching mobile (#3)', async () => {
    render(<Harness initial={[makeFund()]} />)
    await userEvent.click(within(screen.getByTestId('desktop-funds-toolbar')).getByRole('button', { name: 'add' }))
    const select = within(screen.getByTestId('fund-modal')).getByRole('combobox')
    expect(within(select).getAllByRole('option')).toHaveLength(3)
    expect(select.querySelector('option[value="gold"]')).toBeNull()
  })

  it('opens the edit modal prefilled with the fund name', async () => {
    render(<Harness initial={[makeFund({ name: 'Editable Fund' })]} />)
    await userEvent.click(within(screen.getByTestId('fund-row-f1')).getByTestId('fund-edit-btn'))
    expect(screen.getByTestId('fund-modal')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Editable Fund')).toBeInTheDocument()
  })

  it('opens the delete confirmation modal with a localized title key', async () => {
    render(<Harness initial={[makeFund({ code: 'DELME' })]} />)
    await userEvent.click(within(screen.getByTestId('fund-row-f1')).getByTestId('fund-delete-btn'))
    const modal = within(screen.getByTestId('delete-fund-modal'))
    // Title uses t('deleteModal', { name }) — not a hardcoded "Delete DELME?".
    expect(modal.getByText(/deleteModal.*DELME/)).toBeInTheDocument()
  })
})

// ─── DCA inline controls ─────────────────────────────────────────────────────

describe('DesktopFundLibraryView — DCA inline controls', () => {
  it('reveals the amount input and goal dropdown when DCA is toggled on', async () => {
    render(<Harness initial={[makeFund()]} />)
    const row = within(screen.getByTestId('fund-row-f1'))
    await userEvent.click(row.getByTestId('dca-toggle'))
    expect(row.getByTestId('dca-amount-input-f1')).toBeInTheDocument()
    const select = row.getByTestId('dca-goal-f1')
    expect(select).toBeInTheDocument()
    expect(select).toHaveValue('')
  })
})

// ─── Localization (vi) ───────────────────────────────────────────────────────

describe('DesktopFundLibraryView — localization', () => {
  it('renders Vietnamese type labels when the locale is vi', () => {
    i18nState.locale = 'vi'
    render(<Harness initial={[makeFund({ fund_type: 'equity' })]} />)
    // Type chip in the row and the filter pill both use the vi label.
    const toolbar = within(screen.getByTestId('desktop-funds-toolbar'))
    expect(toolbar.getByRole('button', { name: 'Cổ phiếu' })).toBeInTheDocument()
    expect(within(screen.getByTestId('fund-row-f1')).getByText('Cổ phiếu')).toBeInTheDocument()
  })
})
