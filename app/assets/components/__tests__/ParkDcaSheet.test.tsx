import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ParkDcaSheet from '../ParkDcaSheet'
import { todayIso, addMonths } from '@/lib/dates'

// "Gửi tiết kiệm thay": this month's DCA for a fund goes into a new term
// deposit instead. The sheet asks for what the bank needs — bank, amount
// (default: the DCA amount), rate, term — and posts one park request; the
// server files the deposit under the month, the DCA's goal, and the DCA fund
// as its target.

const target = { planId: 'plan-1', fundId: 'f-e1', fundName: 'VFMVN30 ETF', amount: 5_000_000 }
const BANKS = [{ code: 'VCB', name: 'Vietcombank' }, { code: 'TCB', name: 'Techcombank' }]

function api(park: { ok: boolean; body: unknown } = { ok: true, body: { deposit_id: 'dep-1' } }) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (String(url).includes('/api/v1/banks')) return Promise.resolve({ ok: true, json: async () => BANKS })
    if (String(url).includes('/dca-skips/park') && init?.method === 'POST') return Promise.resolve({ ok: park.ok, json: async () => park.body })
    return Promise.resolve({ ok: true, json: async () => [] })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
const parkBody = (f: ReturnType<typeof api>) => {
  const c = f.mock.calls.find((x) => String(x[0]).includes('/dca-skips/park'))
  return c ? { url: String(c[0]), body: JSON.parse(String((c[1] as RequestInit).body)) } : undefined
}

afterEach(() => vi.restoreAllMocks())

describe('ParkDcaSheet', () => {
  it('renders nothing without a target', () => {
    api()
    const { container } = render(<ParkDcaSheet target={null} isVi onClose={() => {}} onDone={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('parks the DCA amount in a term deposit at the chosen bank, rate and term', async () => {
    const user = userEvent.setup()
    const fetchMock = api()
    const onDone = vi.fn()
    render(<ParkDcaSheet target={target} isVi onClose={() => {}} onDone={onDone} />)

    expect(screen.getByTestId('park-dca-amount')).toHaveValue('5.000.000')
    await user.selectOptions(await screen.findByTestId('park-dca-bank'), 'VCB')
    await user.type(screen.getByTestId('park-dca-rate'), '6,5')
    expect(screen.getByTestId('park-dca-term')).toHaveValue('6')
    await user.click(screen.getByTestId('park-dca-submit'))

    await waitFor(() => expect(parkBody(fetchMock)).toBeTruthy())
    expect(parkBody(fetchMock)).toEqual({
      url: '/api/v1/monthly-plans/plan-1/dca-skips/park',
      body: {
        fund_id: 'f-e1', amount_vnd: 5_000_000, interest_rate: 6.5,
        investment_date: todayIso(), expiry_date: addMonths(todayIso(), 6),
        bank_code: 'VCB', notes: 'Vietcombank',
      },
    })
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })

  it('will not send without a rate', async () => {
    api()
    render(<ParkDcaSheet target={target} isVi onClose={() => {}} onDone={() => {}} />)
    expect(screen.getByTestId('park-dca-submit')).toBeDisabled()
  })

  it("shows the server's refusal and stays open", async () => {
    const user = userEvent.setup()
    api({ ok: false, body: { error: "this month's DCA for the fund is already bought" } })
    const onDone = vi.fn()
    render(<ParkDcaSheet target={target} isVi onClose={() => {}} onDone={onDone} />)
    await user.type(screen.getByTestId('park-dca-rate'), '6')
    await user.click(screen.getByTestId('park-dca-submit'))
    expect(await screen.findByText("this month's DCA for the fund is already bought")).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
  })
})
