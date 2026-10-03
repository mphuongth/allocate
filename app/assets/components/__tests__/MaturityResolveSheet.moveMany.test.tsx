import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MaturityResolveBody } from '../MaturityResolveSheet'
import { todayIso, addDaysIso } from '@/lib/dates'
import { fundUnitsFor, interestAtMaturity, splitByShares } from '@/lib/depositMove'
import { formatIntVN } from '@/lib/numberFormat'
import type { InvRow } from '../goalDetailShared'

// A deposit that parked several DCA lines (one 4M deposit for two funds) goes
// back into those funds at maturity. The sheet suggests each fund's part of
// the payout from the share it put in, lets the user correct any of them, and
// moves into all of them in one call (move_deposit_to_funds).

const daysFromNow = (n: number) => addDaysIso(todayIso(), n)

const deposit = (over: Partial<InvRow> = {}): InvRow => ({
  id: 'dep-1',
  name: 'Sổ NCB 6 th.',
  type: 'bank',
  value: 4_000_000,
  gainPct: null,
  units: null,
  principal: 4_000_000,
  interestRate: 6,
  investmentDate: daysFromNow(-192),
  expiryDate: daysFromNow(-10),
  fund: null,
  targetFundId: null,
  ...over,
})

const PAYOUT = 4_000_000 + interestAtMaturity({ principal: 4_000_000, rate: 6, investmentDate: daysFromNow(-192), expiryDate: daysFromNow(-10) })
const [PART_E1, PART_DC] = splitByShares(PAYOUT, [1_000_000, 3_000_000])

const FUNDS = [
  { id: 'f-e1', name: 'VFMVN30 ETF', code: 'E1VFVN30', nav: 25_000 },
  { id: 'f-dc', name: 'DCDS', code: 'DCDS', nav: 90_000 },
]

function api(lines: { fund_id: string; share: number }[] = [
  { fund_id: 'f-e1', share: 1_000_000 },
  { fund_id: 'f-dc', share: 3_000_000 },
]) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/api/v1/user-settings')) return Promise.resolve({ ok: true, json: async () => ({ renew_min_rate_pct: null }) })
    if (u.includes('/api/funds')) return Promise.resolve({ ok: true, json: async () => ({ funds: FUNDS }) })
    if (u.includes('/parked-lines')) return Promise.resolve({ ok: true, json: async () => lines })
    if (u.includes('/move-to-fund') && init?.method === 'POST') {
      return Promise.resolve({ ok: true, json: async () => ({ moves: [] }) })
    }
    return Promise.resolve({ ok: true, json: async () => [] })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const moveBody = (fetchMock: ReturnType<typeof api>) => {
  const c = fetchMock.mock.calls.find((x) => String(x[0]).includes('/move-to-fund'))
  return c ? JSON.parse(String((c[1] as RequestInit).body)) : undefined
}

const renderSheet = (inv = deposit()) =>
  render(<MaturityResolveBody inv={inv} goalId="g1" isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />)

afterEach(() => vi.restoreAllMocks())

describe('MaturityResolveBody — a deposit parked for several funds', () => {
  it('suggests each fund its share of the payout', async () => {
    const user = userEvent.setup()
    api()
    renderSheet()
    await user.click(await screen.findByRole('button', { name: /move to fund/i }))
    const legs = await screen.findByTestId('move-legs')
    expect(within(legs).getByTestId('move-leg-received-f-e1')).toHaveValue(formatIntVN(String(PART_E1)))
    expect(within(legs).getByTestId('move-leg-received-f-dc')).toHaveValue(formatIntVN(String(PART_DC)))
    // One row per fund, not the single-fund picker.
    expect(screen.queryByTestId('move-fund-select')).not.toBeInTheDocument()
  })

  it('moves into every fund in one call, at each fund’s NAV', async () => {
    const user = userEvent.setup()
    const fetchMock = api()
    renderSheet()
    await user.click(await screen.findByRole('button', { name: /move to fund/i }))
    await screen.findByTestId('move-legs')
    await waitFor(() => expect(screen.getByTestId('maturity-confirm')).toBeEnabled())
    await user.click(screen.getByTestId('maturity-confirm'))

    await waitFor(() => expect(moveBody(fetchMock)).toBeTruthy())
    expect(moveBody(fetchMock)).toEqual({
      legs: [
        { fund_id: 'f-e1', received_vnd: PART_E1, units: fundUnitsFor(PART_E1, 25_000), unit_price: 25_000 },
        { fund_id: 'f-dc', received_vnd: PART_DC, units: fundUnitsFor(PART_DC, 90_000), unit_price: 90_000 },
      ],
      date: todayIso(),
    })
    expect(await screen.findByTestId('maturity-moved')).toHaveTextContent(/E1VFVN30.*DCDS/)
  })

  it('takes the amount the user corrects for a fund', async () => {
    const user = userEvent.setup()
    const fetchMock = api()
    renderSheet()
    await user.click(await screen.findByRole('button', { name: /move to fund/i }))
    const field = await screen.findByTestId('move-leg-received-f-dc')
    await user.clear(field)
    await user.type(field, '3000000')
    expect(screen.getByTestId('move-leg-units-f-dc')).toHaveTextContent('33,33')
    await user.click(screen.getByTestId('maturity-confirm'))

    await waitFor(() => expect(moveBody(fetchMock)).toBeTruthy())
    expect(moveBody(fetchMock).legs[1]).toMatchObject({ fund_id: 'f-dc', received_vnd: 3_000_000 })
    expect(moveBody(fetchMock).legs[0]).toMatchObject({ fund_id: 'f-e1', received_vnd: PART_E1 })
  })

  it('keeps the single-fund move for a deposit parked for one fund', async () => {
    const user = userEvent.setup()
    api([{ fund_id: 'f-e1', share: 4_000_000 }])
    renderSheet(deposit({ targetFundId: 'f-e1' }))
    await user.click(await screen.findByRole('button', { name: /move to fund/i }))
    expect(await screen.findByTestId('move-fund-select')).toHaveValue('f-e1')
    expect(screen.queryByTestId('move-legs')).not.toBeInTheDocument()
  })
})
