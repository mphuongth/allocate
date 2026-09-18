import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MobileFundLibraryView from '../MobileFundLibraryView'
import type { Fund } from '../useFundsData'
import { useFundsBusy } from './helpers/fundsBusy'

// The mobile half of the ETF vocabulary (see the desktop file for why it
// matters): `funds.nav` holds an ETF's MARKET price, which is not the NAV its
// manager publishes. The add sheet lives in the mobile top bar, so the edit
// sheet — reachable from a card — is what exercises the shared FundForm here.

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
    id: 'f1', name: 'VFMVF1 Equity Fund', code: 'VFMVF1', fund_type: 'equity', nav: 36120,
    nav_auto_sync: false, is_dca: false, dca_monthly_amount_vnd: null, dca_goal_id: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...over,
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

const openEdit = (id: string) =>
  userEvent.click(within(screen.getByTestId(`fund-card-${id}`)).getByRole('button', { name: 'editFund' }))

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => {
  vi.unstubAllGlobals()
  i18nState.locale = 'en'
})

describe('MobileFundLibraryView — ETFs', () => {
  it('asks for a market price when editing an ETF', async () => {
    render(<Harness initial={[makeFund({ id: 'e1', code: 'FUEVFVND', fund_type: 'etf' })]} />)

    await openEdit('e1')

    expect(screen.getByText('marketPriceLabel')).toBeInTheDocument()
    expect(screen.getByText('priceAutoSyncLabel')).toBeInTheDocument()
    expect(screen.queryByText('navLabel')).not.toBeInTheDocument()
  })

  it('still asks for a NAV when editing an open-ended fund', async () => {
    render(<Harness initial={[makeFund()]} />)

    await openEdit('f1')

    expect(screen.getByText('navLabel')).toBeInTheDocument()
    expect(screen.queryByText('marketPriceLabel')).not.toBeInTheDocument()
  })

  it('does not ask for a price it is about to fetch', async () => {
    // Same rule as desktop: automatic pricing on means the app knows the number,
    // so the form must not send the user to a broker app to copy it back in.
    render(<Harness initial={[makeFund({ id: 'e1', code: 'FUEVFVND', fund_type: 'etf', nav_auto_sync: true })]} />)
    await openEdit('e1')

    const price = screen.getByPlaceholderText('pricePlaceholderAuto')
    await userEvent.clear(price)
    await userEvent.click(screen.getByRole('button', { name: 'saveBtn' }))

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.nav).toBeUndefined()
    expect(body.nav_auto_sync).toBe(true)
  })

  it('keeps the save disabled with no price and nothing to fetch one', async () => {
    render(<Harness initial={[makeFund({ id: 'e1', code: 'FUEVFVND', fund_type: 'etf', nav_auto_sync: false })]} />)
    await openEdit('e1')

    await userEvent.clear(screen.getByPlaceholderText('navPlaceholder'))

    expect(screen.getByRole('button', { name: 'saveBtn' })).toBeDisabled()
  })

  it('follows the type the user picks in the open sheet', async () => {
    // The label tracks the dropdown, not the row it was opened from — otherwise
    // converting a fund to an ETF leaves the form asking for the wrong number.
    render(<Harness initial={[makeFund()]} />)
    await openEdit('f1')

    await userEvent.click(screen.getByTestId('fund-form-type'))
    await userEvent.click(screen.getByTestId('fund-form-type-etf'))

    expect(screen.getByText('marketPriceLabel')).toBeInTheDocument()
  })
})
