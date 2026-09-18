import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DesktopFundLibraryView from '../DesktopFundLibraryView'
import type { Fund } from '../useFundsData'
import { useFundsBusy } from './helpers/fundsBusy'

// An ETF is stored as a fund row, so it shows up in this library alongside the
// open-ended funds. What has to differ is the vocabulary: `funds.nav` holds an
// ETF's MARKET price, and an ETF also has a NAV its manager publishes that this
// number is not. Labelling the column "NAV" puts one number's name over
// another's value.
//
// next-intl is mocked to return the key, so these assertions read as "which
// string was asked for" rather than as English.

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
    id: 'f1', name: 'VFMVF1 Equity Fund', code: 'VFMVF1', fund_type: 'equity', nav: 36120,
    nav_auto_sync: false, is_dca: false, dca_monthly_amount_vnd: null, dca_goal_id: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...over,
  }
}

function Harness({ initial }: { initial: Fund[] }) {
  const [funds, setFunds] = useState(initial)
  return (
    <DesktopFundLibraryView
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

describe('DesktopFundLibraryView — ETFs', () => {
  it('names the price column for both kinds of holding at once', () => {
    // One table, two kinds of price. A per-row label is impossible in a column
    // header, so the header has to be true of both.
    render(<Harness initial={[makeFund(), makeFund({ id: 'f2', code: 'FUEVFVND', fund_type: 'etf' })]} />)
    expect(screen.getByText('colPricePerUnit')).toBeInTheDocument()
    expect(screen.queryByText('colNav')).not.toBeInTheDocument()
  })

  it('offers ETF as a type to create, and asks for a market price when picked', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[makeFund()]} />)

    await user.click(within(screen.getByTestId('desktop-funds-toolbar')).getByRole('button', { name: 'add' }))
    // Defaults to an open-ended fund, which is priced by NAV.
    expect(screen.getByText('navLabel')).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox'), 'etf')

    expect(screen.getByText('marketPriceLabel')).toBeInTheDocument()
    expect(screen.queryByText('navLabel')).not.toBeInTheDocument()
  })

  it('asks about a market price when editing an ETF, and a NAV when editing a fund', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[makeFund({ id: 'e1', code: 'FUEVFVND', name: 'DCVFM VN DIAMOND', fund_type: 'etf' })]} />)

    await user.click(screen.getByTestId('fund-edit-btn'))
    expect(screen.getByText('marketPriceLabel')).toBeInTheDocument()
    // The automatic-sync toggle is about the same number, so it moves with it.
    expect(screen.getByText('priceAutoSyncLabel')).toBeInTheDocument()
  })

  it('does not ask for a price it is about to fetch', async () => {
    // Automatic pricing on means the app knows the number. Demanding it in the
    // form sends the user off to a broker app to copy a figure back in.
    const user = userEvent.setup()
    render(<Harness initial={[]} />)

    await user.click(within(screen.getByTestId('desktop-funds-toolbar')).getByRole('button', { name: 'add' }))
    await user.selectOptions(screen.getByRole('combobox'), 'etf')
    await user.type(screen.getByPlaceholderText('namePlaceholder'), 'DCVFM VN DIAMOND')
    await user.type(screen.getByPlaceholderText('codePlaceholder'), 'FUEVFVND')
    await user.click(screen.getByRole('checkbox'))
    await user.click(within(screen.getByTestId('fund-modal')).getByRole('button', { name: 'add' }))

    expect(screen.queryByText('priceRequired')).not.toBeInTheDocument()
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.nav_auto_sync).toBe(true)
    expect(body.nav).toBeUndefined()
  })

  it('still asks for a price when nothing will fetch one', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[]} />)

    await user.click(within(screen.getByTestId('desktop-funds-toolbar')).getByRole('button', { name: 'add' }))
    await user.selectOptions(screen.getByRole('combobox'), 'etf')
    await user.type(screen.getByPlaceholderText('namePlaceholder'), 'By hand')
    await user.type(screen.getByPlaceholderText('codePlaceholder'), 'MANUAL')
    await user.click(within(screen.getByTestId('fund-modal')).getByRole('button', { name: 'add' }))

    expect(screen.getByText('priceRequired')).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('filters the library down to ETFs', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[
      makeFund({ id: 'f1', code: 'VFMVF1', fund_type: 'equity' }),
      makeFund({ id: 'e1', code: 'FUEVFVND', fund_type: 'etf' }),
    ]} />)

    await user.click(within(screen.getByTestId('desktop-funds-toolbar')).getByRole('button', { name: 'ETF' }))

    expect(screen.getByText('FUEVFVND')).toBeInTheDocument()
    expect(screen.queryByText('VFMVF1')).not.toBeInTheDocument()
  })
})
