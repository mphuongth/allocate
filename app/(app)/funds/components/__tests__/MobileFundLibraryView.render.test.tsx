import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MobileFundLibraryView from '../MobileFundLibraryView'
import type { Fund } from '../useFundsData'
import { useFundsBusy } from './helpers/fundsBusy'
import { chooseFundAction } from './helpers/fundCardMenu'

// Presence/render + filter coverage for the mobile Funds list. Moved off E2E per
// the test-layering policy. The header add/refresh actions live in the mobile top
// bar (pushed via NavigationContext.setMobileTopBar, mocked here), so the add-sheet
// open and the ≥44px touch-target / goal-overflow layout checks stay in E2E; the
// edit sheet (reachable from a card) covers the shared FundForm here.
// next-intl is mocked to return the key; a mutable locale drives the vi label test.

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

vi.mock('@/components/navigation/NavigationContext', () => ({
  useNavigation: () => ({ setMobileTopBar: vi.fn() }),
}))

function makeFund(over: Partial<Fund> = {}): Fund {
  return {
    id: 'f1',
    name: 'VFMVF1 Equity Fund',
    code: 'VFMVF1',
    fund_type: 'equity',
    nav: 36120,
    nav_auto_sync: false,
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
    <MobileFundLibraryView
      {...useFundsBusy()}
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

// ─── Toolbar (search + filter chips) ─────────────────────────────────────────

describe('MobileFundLibraryView — toolbar', () => {
  it('shows the search input', () => {
    render(<Harness initial={[makeFund()]} />)
    expect(screen.getByPlaceholderText('searchPlaceholder')).toBeInTheDocument()
  })

  it('shows the four type filter chips', () => {
    render(<Harness initial={[makeFund()]} />)
    for (const name of ['All', 'Stock', 'Bond', 'Balanced']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })
})

// ─── Fund card ───────────────────────────────────────────────────────────────

describe('MobileFundLibraryView — fund card', () => {
  it('renders code, type chip and a DCA toggle', () => {
    render(<Harness initial={[makeFund({ code: 'E2EEQ' })]} />)
    const card = within(screen.getByTestId('fund-card-f1'))
    expect(card.getByText('E2EEQ')).toBeInTheDocument()
    expect(card.getByText('Stock')).toBeInTheDocument()
    expect(card.getByRole('button', { name: 'enableDca' })).toBeInTheDocument()
  })

  it('exposes localized edit/delete/DCA accessible names (uses t(), not hardcoded English)', async () => {
    render(<Harness initial={[makeFund()]} />)
    const card = within(screen.getByTestId('fund-card-f1'))
    expect(card.getByRole('button', { name: 'enableDca' })).toBeInTheDocument()
    await userEvent.click(card.getByRole('button', { name: 'fundActions' }))
    expect(screen.getByRole('menuitem', { name: 'editFund' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'deleteBtn' })).toBeInTheDocument()
  })
})

// ─── Edit/delete menu (#769) ─────────────────────────────────────────────────

// A red delete icon on every card, a thumb's width from edit, was one slip from
// the delete sheet and visual noise on a list of funds. Both now sit behind "⋯".
describe('MobileFundLibraryView — edit/delete menu', () => {
  it('shows no delete control on the card until the menu is opened', () => {
    render(<Harness initial={[makeFund()]} />)
    const card = within(screen.getByTestId('fund-card-f1'))
    expect(card.queryByRole('button', { name: 'deleteBtn' })).toBeNull()
    expect(card.queryByRole('button', { name: 'editFund' })).toBeNull()
    expect(screen.queryByRole('menu')).toBeNull()
    const trigger = card.getByRole('button', { name: 'fundActions' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens a menu with edit and a delete marked as destructive', async () => {
    render(<Harness initial={[makeFund()]} />)
    const trigger = within(screen.getByTestId('fund-card-f1')).getByRole('button', { name: 'fundActions' })
    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const menu = within(screen.getByRole('menu'))
    const items = menu.getAllByRole('menuitem').map((i) => i.textContent)
    expect(items).toEqual(['editFund', 'deleteBtn'])
    expect(menu.getByRole('menuitem', { name: 'deleteBtn' })).toHaveStyle({ color: 'var(--c-neg)' })
  })

  it('closes the menu once an item is chosen', async () => {
    render(<Harness initial={[makeFund()]} />)
    await chooseFundAction('deleteBtn')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByTestId('delete-fund-sheet')).toBeInTheDocument()
  })

  it('closes on Escape without opening anything', async () => {
    render(<Harness initial={[makeFund()]} />)
    await userEvent.click(within(screen.getByTestId('fund-card-f1')).getByRole('button', { name: 'fundActions' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByTestId('delete-fund-sheet')).toBeNull()
    expect(screen.queryByTestId('fund-sheet')).toBeNull()
  })

  it('closes on a tap outside it', async () => {
    render(<Harness initial={[makeFund()]} />)
    await userEvent.click(within(screen.getByTestId('fund-card-f1')).getByRole('button', { name: 'fundActions' }))
    await userEvent.click(screen.getByTestId('fund-menu-backdrop'))
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

// ─── Search + type filter ────────────────────────────────────────────────────

describe('MobileFundLibraryView — search & type filter', () => {
  it('filters cards by code via the search box', async () => {
    render(<Harness initial={[makeFund({ id: 'a', code: 'AAAA' }), makeFund({ id: 'b', code: 'BBBB' })]} />)
    await userEvent.type(screen.getByPlaceholderText('searchPlaceholder'), 'AAAA')
    expect(screen.getByTestId('fund-card-a')).toBeInTheDocument()
    expect(screen.queryByTestId('fund-card-b')).not.toBeInTheDocument()
  })

  it('shows only matching funds when a type chip is selected', async () => {
    render(<Harness initial={[makeFund({ id: 'eq', fund_type: 'equity' }), makeFund({ id: 'bd', fund_type: 'debt' })]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Stock' }))
    expect(screen.getByTestId('fund-card-eq')).toBeInTheDocument()
    expect(screen.queryByTestId('fund-card-bd')).not.toBeInTheDocument()
  })

  it('shows the no-results state when the search matches nothing', async () => {
    render(<Harness initial={[makeFund({ code: 'AAAA' })]} />)
    await userEvent.type(screen.getByPlaceholderText('searchPlaceholder'), 'ZZZZ')
    expect(screen.getByText('noMatch')).toBeInTheDocument()
  })

  it('shows the empty state when there are no funds', () => {
    render(<Harness initial={[]} />)
    // FundsEmptyState renders an add action; the list/no-match states are absent.
    expect(screen.queryByText('noMatch')).not.toBeInTheDocument()
    expect(screen.queryByTestId('fund-card-f1')).not.toBeInTheDocument()
  })
})

// ─── Edit + delete sheets ────────────────────────────────────────────────────

describe('MobileFundLibraryView — sheets', () => {
  it('opens the edit sheet prefilled, with localized form placeholders', async () => {
    render(<Harness initial={[makeFund({ name: 'Editable Fund' })]} />)
    await chooseFundAction('editFund')
    const sheet = within(screen.getByTestId('fund-sheet'))
    expect(sheet.getByDisplayValue('Editable Fund')).toBeInTheDocument()
    // Placeholders come from t() (namePlaceholder), not hardcoded English.
    expect(sheet.getByPlaceholderText('namePlaceholder')).toBeInTheDocument()
  })

  // #445 — on a VN mobile keypad the only decimal key is a comma; the NAV field
  // must show the VN format and accept that comma as the decimal separator.
  it('shows the NAV in VN format and accepts a comma decimal (issue #445)', async () => {
    render(<Harness initial={[makeFund({ name: 'Editable Fund', nav: 36120.5 })]} />)
    await chooseFundAction('editFund')
    const sheet = within(screen.getByTestId('fund-sheet'))
    const navInput = sheet.getByPlaceholderText('navPlaceholder') as HTMLInputElement
    expect(navInput.value).toBe('36.120,5')
    fireEvent.change(navInput, { target: { value: '36.120,75' } })
    expect(navInput.value).toBe('36.120,75')
  })

  it('opens the delete sheet with a localized title key', async () => {
    render(<Harness initial={[makeFund({ code: 'DELME' })]} />)
    await chooseFundAction('deleteBtn')
    const sheet = within(screen.getByTestId('delete-fund-sheet'))
    // Title uses t('deleteModal', { name }) — not a hardcoded "Delete DELME?".
    expect(sheet.getByText(/deleteModal.*DELME/)).toBeInTheDocument()
  })
})

// ─── Touch targets (#766) ────────────────────────────────────────────────────

describe('MobileFundLibraryView — touch targets', () => {
  it('gives the sort button a 44px hit area', () => {
    render(<Harness initial={[makeFund()]} />)
    expect(screen.getByTestId('fund-sort-btn')).toHaveClass('hit-44')
  })

  it('gives the DCA amount chip a 44px hit area', () => {
    render(<Harness initial={[makeFund({ is_dca: true, dca_monthly_amount_vnd: 2_000_000 })]} />)
    expect(screen.getByTestId('dca-amount-btn-f1')).toHaveClass('hit-44')
  })

  it('gives the "set amount" chip a 44px hit area', () => {
    render(<Harness initial={[makeFund({ is_dca: true, dca_monthly_amount_vnd: null })]} />)
    const card = within(screen.getByTestId('fund-card-f1'))
    expect(card.getByRole('button', { name: 'setAmount' })).toHaveClass('hit-44')
  })
})

// ─── DCA inline controls ─────────────────────────────────────────────────────

describe('MobileFundLibraryView — DCA inline controls', () => {
  it('reveals the amount input and goal dropdown when DCA is toggled on', async () => {
    render(<Harness initial={[makeFund()]} />)
    const card = within(screen.getByTestId('fund-card-f1'))
    await userEvent.click(card.getByRole('button', { name: 'enableDca' }))
    expect(card.getByTestId('dca-amount-input-f1')).toBeInTheDocument()
    const select = card.getByTestId('dca-goal-f1')
    expect(select).toBeInTheDocument()
    expect(select).toHaveValue('')
  })

  // appearance:none strips the native arrow, so without one of our own the
  // goal picker reads as plain text nobody thinks to tap (#765).
  it('draws a chevron on the goal dropdown, hidden from screen readers', async () => {
    render(<Harness initial={[makeFund()]} />)
    const card = within(screen.getByTestId('fund-card-f1'))
    await userEvent.click(card.getByRole('button', { name: 'enableDca' }))
    const chevron = card.getByTestId('dca-goal-chevron-f1')
    expect(chevron).toHaveAttribute('aria-hidden', 'true')
    // Clicks fall through to the select underneath.
    expect(chevron).toHaveStyle({ pointerEvents: 'none' })
    expect(chevron.parentElement).toContainElement(card.getByTestId('dca-goal-f1'))
  })
})

// ─── Localization (vi) ───────────────────────────────────────────────────────

describe('MobileFundLibraryView — localization', () => {
  it('renders Vietnamese type labels when the locale is vi', () => {
    i18nState.locale = 'vi'
    render(<Harness initial={[makeFund({ fund_type: 'equity' })]} />)
    // The filter chip and the card type chip both use the vi label.
    expect(screen.getByRole('button', { name: 'Cổ phiếu' })).toBeInTheDocument()
    expect(within(screen.getByTestId('fund-card-f1')).getByText('Cổ phiếu')).toBeInTheDocument()
  })
})
