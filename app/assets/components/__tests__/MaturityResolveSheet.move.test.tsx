import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MaturityResolveBody } from '../MaturityResolveSheet'
import { fmt } from '@/lib/formatters'
import { todayIso, addDaysIso } from '@/lib/dates'
import { fundUnitsFor } from '@/lib/depositMove'
import type { InvRow } from '../goalDetailShared'

// At maturity the user enters today's 12-month rate. At or above their
// threshold (Settings, default 8%) the sheet suggests renewing principal +
// interest; below it, moving principal + interest into the deposit's target
// fund. The sheet only suggests — the user still confirms — and the move is one
// call to /move-to-fund (move_deposit_to_fund), which keeps the goal whole.

const daysFromNow = (n: number) => addDaysIso(todayIso(), n)

// 100M at 6% held 182 days: the bank pays 100M × 6% × 182/365 = 2,991,781.
const INTEREST = 2_991_781
const PAYOUT = 100_000_000 + INTEREST

const deposit = (over: Partial<InvRow> = {}): InvRow => ({
  id: 'dep-1',
  name: 'Sổ VCB 6 th.',
  type: 'bank',
  value: PAYOUT,
  gainPct: 2.99,
  units: null,
  principal: 100_000_000,
  interestRate: 6,
  investmentDate: daysFromNow(-192),
  expiryDate: daysFromNow(-10),
  fund: null,
  targetFundId: 'f-e1',
  ...over,
})

const FUNDS = [
  { id: 'f-e1', name: 'VFMVN30 ETF', code: 'E1VFVN30', nav: 25_000 },
  { id: 'f-dc', name: 'DCDS', code: 'DCDS', nav: 90_000 },
]

function api(opts: { threshold?: number | null; move?: { ok: boolean; body: unknown } } = {}) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/api/v1/user-settings')) return Promise.resolve({ ok: true, json: async () => ({ inflation_rate_pct: null, renew_min_rate_pct: opts.threshold ?? null }) })
    if (u.includes('/api/funds')) return Promise.resolve({ ok: true, json: async () => ({ funds: FUNDS }) })
    if (u.includes('/move-to-fund') && init?.method === 'POST') {
      const m = opts.move ?? { ok: true, body: { withdrawal_id: 'wd-1', purchase_id: 'buy-1' } }
      return Promise.resolve({ ok: m.ok, json: async () => m.body })
    }
    return Promise.resolve({ ok: true, json: async () => [] })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const moveCall = (fetchMock: ReturnType<typeof api>) => {
  const c = fetchMock.mock.calls.find((x) => String(x[0]).includes('/move-to-fund'))
  return c ? { url: String(c[0]), body: JSON.parse(String((c[1] as RequestInit).body)) } : undefined
}

const renderSheet = (inv = deposit(), onRenewed = vi.fn()) =>
  render(<MaturityResolveBody inv={inv} goalId="g1" isVi={false} onClose={() => {}} onRenewed={onRenewed} onWithdraw={() => {}} />)

const rateField = () => screen.getByRole('textbox', { name: /today's 12-month rate/i })

afterEach(() => vi.restoreAllMocks())

describe('MaturityResolveBody — renew or move to the target fund', () => {
  it('states what the deposit pays at maturity', async () => {
    api()
    renderSheet()
    expect(await screen.findByTestId('maturity-interest-at-maturity')).toHaveTextContent(fmt(INTEREST))
  })

  it('suggests renewing principal + interest at or above the 8% default', async () => {
    const user = userEvent.setup()
    api()
    renderSheet()
    await user.type(rateField(), '8')
    expect(await screen.findByTestId('maturity-suggestion')).toHaveTextContent(/renew principal \+ interest/i)
    // …and preselects it: the renewal preview is what is on screen.
    expect(screen.getByTestId('maturity-new-principal')).toBeInTheDocument()
    expect(screen.queryByTestId('move-to-fund')).not.toBeInTheDocument()
  })

  it('suggests moving to the target fund below the threshold, and preselects the move', async () => {
    const user = userEvent.setup()
    api()
    renderSheet()
    await user.type(rateField(), '7,5')
    expect(await screen.findByTestId('maturity-suggestion')).toHaveTextContent(/move .* to E1VFVN30/i)
    const move = await screen.findByTestId('move-to-fund')
    await waitFor(() => expect(within(move).getByTestId('move-fund-select')).toHaveValue('f-e1'))
  })

  it("uses the user's own threshold from Settings", async () => {
    const user = userEvent.setup()
    api({ threshold: 7 })
    renderSheet()
    await waitFor(() => expect(screen.getByTestId('maturity-threshold')).toHaveTextContent('7%'))
    await user.type(rateField(), '7,5')
    expect(await screen.findByTestId('maturity-suggestion')).toHaveTextContent(/renew/i)
  })

  it('moves principal + interest into the target fund at its NAV, in one call', async () => {
    const user = userEvent.setup()
    const fetchMock = api()
    const onRenewed = vi.fn()
    renderSheet(deposit(), onRenewed)
    await user.click(await screen.findByRole('button', { name: /move to fund/i }))
    const move = await screen.findByTestId('move-to-fund')
    await waitFor(() => expect(within(move).getByTestId('move-units')).toHaveTextContent('4.119,67'))

    await user.click(screen.getByTestId('maturity-confirm'))

    await waitFor(() => expect(moveCall(fetchMock)).toBeTruthy())
    const { url, body } = moveCall(fetchMock)!
    expect(url).toBe('/api/v1/investment-transactions/dep-1/move-to-fund')
    expect(body).toEqual({
      received_vnd: PAYOUT,
      fund_id: 'f-e1',
      units: fundUnitsFor(PAYOUT, 25_000),
      unit_price: 25_000,
      date: todayIso(),
    })
    expect(await screen.findByTestId('maturity-moved')).toHaveTextContent('E1VFVN30')
  })

  it('reprices when the user corrects the payout or picks another fund', async () => {
    const user = userEvent.setup()
    api()
    renderSheet()
    await user.click(await screen.findByRole('button', { name: /move to fund/i }))
    const move = await screen.findByTestId('move-to-fund')
    await user.selectOptions(within(move).getByTestId('move-fund-select'), 'f-dc')
    const received = within(move).getByTestId('move-received')
    await user.clear(received)
    await user.type(received, '90000000')
    expect(within(move).getByTestId('move-units')).toHaveTextContent('1.000')
  })

  it('asks for a fund when the deposit has no target', async () => {
    const user = userEvent.setup()
    api()
    renderSheet(deposit({ targetFundId: null }))
    await user.click(await screen.findByRole('button', { name: /move to fund/i }))
    expect(await screen.findByTestId('move-fund-select')).toHaveValue('')
    expect(screen.getByTestId('maturity-confirm')).toBeDisabled()
  })

  it('does not move a deposit before it matures', async () => {
    const user = userEvent.setup()
    api()
    renderSheet(deposit({ expiryDate: daysFromNow(5) }))
    await user.click(await screen.findByRole('button', { name: /move to fund/i }))
    expect(screen.getByTestId('maturity-confirm')).toBeDisabled()
    expect(screen.getByTestId('maturity-too-early-hint')).toBeInTheDocument()
  })

  it("shows the server's refusal instead of pretending it worked", async () => {
    const user = userEvent.setup()
    api({ move: { ok: false, body: { error: 'the deposit is already closed', code: 'move_refused' } } })
    renderSheet()
    await user.click(await screen.findByRole('button', { name: /move to fund/i }))
    await waitFor(() => expect(screen.getByTestId('maturity-confirm')).toBeEnabled())
    await user.click(screen.getByTestId('maturity-confirm'))
    expect(await screen.findByText('the deposit is already closed')).toBeInTheDocument()
    expect(screen.queryByTestId('maturity-moved')).not.toBeInTheDocument()
  })

  it('offers neither the suggestion nor the move for an accumulating book', async () => {
    api()
    renderSheet(deposit({ depositGroupId: 'dep-1' }))
    await screen.findByRole('button', { name: /confirm renewal|confirm/i })
    expect(screen.queryByRole('textbox', { name: /today's 12-month rate/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /move to fund/i })).not.toBeInTheDocument()
  })
})
