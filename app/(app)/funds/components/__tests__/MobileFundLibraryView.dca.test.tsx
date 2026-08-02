import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MobileFundLibraryView from '../MobileFundLibraryView'
import type { Fund } from '../useFundsData'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  useLocale: () => 'en',
}))

vi.mock('@/lib/formatters', () => ({
  fmtNav: (n: number) => String(n),
  fmtCompact: (n: number) => `${n}`,
}))

vi.mock('@/app/components/navigation/NavigationContext', () => ({
  useNavigation: () => ({ setMobileTopBar: vi.fn() }),
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

function Harness({ initial, reload }: { initial: Fund[]; reload: () => Promise<void> }) {
  const [funds, setFunds] = useState(initial)
  return (
    <MobileFundLibraryView
      funds={funds}
      setFunds={setFunds}
      goals={[]}
      loading={false}
      error={false}
      reload={reload}
    />
  )
}

let fetchMock: ReturnType<typeof vi.fn>
let reload: Mock<() => Promise<void>>

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }))
  vi.stubGlobal('fetch', fetchMock)
  reload = vi.fn(() => Promise.resolve())
})
afterEach(() => vi.unstubAllGlobals())

describe('MobileFundLibraryView — DCA amount edit must not desync from the server (#2)', () => {
  it('clearing an already-saved DCA amount keeps the card enabled and sends NO disabling PUT', async () => {
    render(<Harness initial={[makeFund({ is_dca: true, dca_monthly_amount_vnd: 2_000_000 })]} reload={reload} />)

    await userEvent.click(screen.getByTestId('dca-amount-btn-f1'))
    const input = screen.getByTestId('dca-amount-input-f1') as HTMLInputElement
    await userEvent.clear(input)
    fireEvent.blur(input)

    expect(screen.getByLabelText('disableDca')).toBeInTheDocument()
    expect(screen.getByTestId('dca-amount-btn-f1')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a brand-new (just-toggled-on) DCA reverts to off when left blank — no PUT', async () => {
    render(<Harness initial={[makeFund({ is_dca: false })]} reload={reload} />)

    await userEvent.click(screen.getByLabelText('enableDca'))
    const input = screen.getByTestId('dca-amount-input-f1')
    fireEvent.blur(input)

    expect(screen.getByLabelText('enableDca')).toBeInTheDocument()
    expect(screen.queryByTestId('dca-amount-btn-f1')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Same assertion as the desktop spec: after a failed edit both viewports must
  // still show the configuration the server kept, not "DCA off" (#590).
  it('a failed edit of a saved amount leaves the card enabled at its previous amount', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) })
    render(<Harness initial={[makeFund({ is_dca: true, dca_monthly_amount_vnd: 2_000_000 })]} reload={reload} />)

    await userEvent.click(screen.getByTestId('dca-amount-btn-f1'))
    const input = screen.getByTestId('dca-amount-input-f1')
    await userEvent.clear(input)
    await userEvent.type(input, '3000000')
    fireEvent.blur(input)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByLabelText('disableDca')).toBeInTheDocument())
    expect(screen.getByTestId('dca-amount-btn-f1')).toHaveTextContent('2000000')
    expect(reload).not.toHaveBeenCalled()
  })

  it('a failed first save of a just-enabled DCA leaves the card off', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) })
    render(<Harness initial={[makeFund({ is_dca: false })]} reload={reload} />)

    await userEvent.click(screen.getByLabelText('enableDca'))
    const input = screen.getByTestId('dca-amount-input-f1')
    await userEvent.type(input, '3000000')
    fireEvent.blur(input)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByLabelText('enableDca')).toBeInTheDocument())
    expect(screen.queryByTestId('dca-amount-btn-f1')).not.toBeInTheDocument()
  })

  it('a valid amount edit still persists with a PUT (is_dca true) and reloads', async () => {
    render(<Harness initial={[makeFund({ is_dca: true, dca_monthly_amount_vnd: 2_000_000 })]} reload={reload} />)

    await userEvent.click(screen.getByTestId('dca-amount-btn-f1'))
    const input = screen.getByTestId('dca-amount-input-f1')
    await userEvent.clear(input)
    await userEvent.type(input, '3000000')
    fireEvent.blur(input)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, opts] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('/api/funds/f1')
    expect(opts.method).toBe('PUT')
    const body = JSON.parse(opts.body)
    expect(body.is_dca).toBe(true)
    expect(body.dca_monthly_amount_vnd).toBe(3_000_000)
    await waitFor(() => expect(reload).toHaveBeenCalled())
  })
})
