import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FinishGoalSheet } from '../FinishGoalSheet'
import type { InvRow } from '@/features/dashboard/contracts'

// The "Liquidate & finish" sheet (#650). Everything money-shaped is asserted in
// lib/__tests__/finishGoal.test.ts; what matters here is that the user can never
// submit a finish the ledger would refuse — a half-filled plan, or a goal
// something still feeds — and that a blocker is NAMED rather than reported as a
// generic failure.

vi.mock('next-intl', () => ({ useLocale: () => 'en' }))

const row = (over: Partial<InvRow>): InvRow => ({
  id: 'tx-1', name: 'ACB deposit', type: 'bank', value: 10_000_000, gainPct: null,
  units: null, principal: 10_000_000, interestRate: 5, expiryDate: null,
  investmentDate: '2026-01-01', fund: null, ...over,
})

const ROWS = [row({}), row({ id: 'gold-1', name: 'Gold', type: 'gold', units: 2, value: 8_000_000 })]

// What the server says the goal holds. The sheet builds its plan from THIS, not
// from the page's newest-200 window — see the truncation test below.
const SERVER_HOLDINGS = [
  { key: 'tx:tx-1', kind: 'single', asset_type: 'bank', principal: 10_000_000, units: null, name: 'ACB deposit', value: 10_000_000 },
  { key: 'tx:gold-1', kind: 'single', asset_type: 'gold', principal: 8_000_000, units: 2, name: 'Gold', value: 8_000_000 },
]

let fetchMock: ReturnType<typeof vi.fn>

function mountSheet(props: Partial<Parameters<typeof FinishGoalSheet>[0]> = {}) {
  return render(
    <FinishGoalSheet
      open
      goalId="g1"
      goalName="New kitchen"
      rows={ROWS}
      onClose={vi.fn()}
      onFinished={vi.fn()}
      {...props}
    />,
  )
}

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (!init || init.method !== 'POST') {
      return { ok: true, json: async () => ({ blockers: [], holdings: SERVER_HOLDINGS, completed: false }) }
    }
    return { ok: true, json: async () => ({ realized: 18_400_000, holdings: 2, completionPercentage: 100 }) }
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => { vi.unstubAllGlobals() })

describe('FinishGoalSheet', () => {
  it('prefills every holding from what it is worth today and totals them', async () => {
    mountSheet()
    await waitFor(() => expect(screen.getByTestId('finish-goal-confirm')).toBeEnabled())
    // 10,000,000 deposit + 2 chỉ × 4,000,000 (the price its valuation implies).
    expect(screen.getByTestId('finish-goal-total')).toHaveTextContent('18.000.000')
  })

  it('will not submit while a holding has no figure', async () => {
    const user = userEvent.setup()
    mountSheet()
    await waitFor(() => expect(screen.getByTestId('finish-goal-confirm')).toBeEnabled())
    await user.clear(screen.getByTestId('finish-input-tx:gold-1'))
    expect(screen.getByTestId('finish-goal-confirm')).toBeDisabled()
    await user.click(screen.getByTestId('finish-goal-confirm'))
    expect(fetchMock.mock.calls.filter((c) => c[1]?.method === 'POST')).toHaveLength(0)
  })

  it('posts one plan entry per holding, with what the user actually received', async () => {
    const user = userEvent.setup()
    mountSheet()
    await waitFor(() => expect(screen.getByTestId('finish-goal-confirm')).toBeEnabled())
    // An early withdrawal forfeited the interest — the deposit paid out less.
    await user.clear(screen.getByTestId('finish-input-tx:tx-1'))
    await user.type(screen.getByTestId('finish-input-tx:tx-1'), '9800000')
    await user.click(screen.getByTestId('finish-goal-confirm'))

    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')
    expect(JSON.parse(post![1].body as string)).toEqual({
      plan: [
        { key: 'tx:tx-1', received: 9_800_000 },
        // Gold is entered per chỉ and multiplied out.
        { key: 'tx:gold-1', received: 8_000_000 },
      ],
    })
  })

  it('names what still feeds the goal instead of offering a doomed form', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ blockers: [{ code: 'dca_plan', label: 'VESAF' }], holdings: SERVER_HOLDINGS, completed: false }),
    }))
    mountSheet()
    await waitFor(() => expect(screen.getByTestId('finish-goal-blockers')).toBeInTheDocument())
    expect(screen.getByText('VESAF')).toBeInTheDocument()
    expect(screen.getByText(/Funds page/)).toBeInTheDocument()
    expect(screen.queryByTestId('finish-goal-confirm')).not.toBeInTheDocument()
  })

  it('re-renders as a blocker when one appears between opening and submitting', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => (
      init?.method === 'POST'
        ? { ok: false, status: 409, json: async () => ({ error: 'Something still feeds this goal.', code: 'blocked_recurring_saving' }) }
        : { ok: true, json: async () => ({ blockers: [], holdings: SERVER_HOLDINGS, completed: false }) }
    ))
    mountSheet()
    await waitFor(() => expect(screen.getByTestId('finish-goal-confirm')).toBeEnabled())
    await user.click(screen.getByTestId('finish-goal-confirm'))
    await waitFor(() => expect(screen.getByTestId('finish-goal-blockers')).toBeInTheDocument())
    expect(screen.getByText(/recurring saving/i)).toBeInTheDocument()
  })

  it('reports a refusal instead of claiming the goal was finished', async () => {
    const user = userEvent.setup()
    const onFinished = vi.fn()
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => (
      init?.method === 'POST'
        ? { ok: false, status: 409, json: async () => ({ error: 'the liquidation plan leaves holding tx:x unrealized', code: 'stale_plan' }) }
        : { ok: true, json: async () => ({ blockers: [], holdings: SERVER_HOLDINGS, completed: false }) }
    ))
    mountSheet({ onFinished })
    await waitFor(() => expect(screen.getByTestId('finish-goal-confirm')).toBeEnabled())
    await user.click(screen.getByTestId('finish-goal-confirm'))
    await waitFor(() => expect(screen.getByText(/leaves holding tx:x unrealized/)).toBeInTheDocument())
    expect(onFinished).not.toHaveBeenCalled()
    expect(screen.queryByTestId('finish-goal-success')).not.toBeInTheDocument()
  })

  it('shows the realized total the server reports on success', async () => {
    const user = userEvent.setup()
    mountSheet()
    await waitFor(() => expect(screen.getByTestId('finish-goal-confirm')).toBeEnabled())
    await user.click(screen.getByTestId('finish-goal-confirm'))
    await waitFor(() => expect(screen.getByTestId('finish-goal-success')).toBeInTheDocument())
    expect(screen.getByText('₫ 18.400.000')).toBeInTheDocument()
  })

  it('will not present the goal as ready when the blocker check failed', async () => {
    // A 500 read as "no blockers" is the worst of both: the sheet enables a
    // submit on a prerequisite that never ran.
    fetchMock.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    mountSheet()
    await waitFor(() => expect(screen.getByTestId('finish-goal-check-failed')).toBeInTheDocument())
    expect(screen.queryByTestId('finish-goal-confirm')).not.toBeInTheDocument()
  })

  it('will not submit a holding that realizes nothing', async () => {
    // amount_vnd must be positive, so a zero would roll the whole finish back.
    const user = userEvent.setup()
    mountSheet()
    await waitFor(() => expect(screen.getByTestId('finish-goal-confirm')).toBeEnabled())
    await user.clear(screen.getByTestId('finish-input-tx:tx-1'))
    await user.type(screen.getByTestId('finish-input-tx:tx-1'), '0')
    expect(screen.getByTestId('finish-goal-confirm')).toBeDisabled()
  })

  it('offers a holding this page never loaded, priced from the ledger', async () => {
    // A goal with more than 200 transactions loads only the newest page, so an
    // older holding is absent from `rows`. It must still appear, or the plan
    // misses its key and the finish is refused as incomplete — permanently.
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => (
      init?.method === 'POST'
        ? { ok: true, json: async () => ({ realized: 21_000_000, holdings: 3 }) }
        : {
          ok: true,
          json: async () => ({
            blockers: [],
            holdings: [
              ...SERVER_HOLDINGS,
              { key: 'tx:old-1', kind: 'single', asset_type: 'bank', principal: 3_000_000, units: null, name: 'Sổ cũ', value: 3_000_000 },
            ],
            completed: false,
          }),
        }
    ))
    mountSheet()
    await waitFor(() => expect(screen.getByTestId('finish-input-tx:old-1')).toBeInTheDocument())
    expect(screen.getByText('Sổ cũ')).toBeInTheDocument()
    // Prefilled from what the ledger says it still holds.
    expect(screen.getByTestId('finish-goal-total')).toHaveTextContent('21.000.000')

    await user.click(screen.getByTestId('finish-goal-confirm'))
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')
    expect(JSON.parse(post![1].body as string).plan).toEqual([
      { key: 'tx:tx-1', received: 10_000_000 },
      { key: 'tx:gold-1', received: 8_000_000 },
      { key: 'tx:old-1', received: 3_000_000 },
    ])
  })

  it('leaves gold with no price empty, and will not submit until it is stated', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => (
      init?.method === 'POST'
        ? { ok: true, json: async () => ({ realized: 9_000_000, holdings: 1 }) }
        : {
          ok: true,
          json: async () => ({
            blockers: [],
            holdings: [{ key: 'tx:gold-1', kind: 'single', asset_type: 'gold', principal: 8_000_000, units: 2, name: 'Gold', value: null }],
            completed: false,
          }),
        }
    ))
    mountSheet()
    await waitFor(() => expect(screen.getByTestId('finish-input-tx:gold-1')).toHaveValue(''))
    expect(screen.getByText(/No gold price set/)).toBeInTheDocument()
    expect(screen.getByTestId('finish-goal-confirm')).toBeDisabled()

    await user.type(screen.getByTestId('finish-input-tx:gold-1'), '4500000')
    expect(screen.getByTestId('finish-goal-confirm')).toBeEnabled()
    await user.click(screen.getByTestId('finish-goal-confirm'))
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')
    expect(JSON.parse(post![1].body as string).plan).toEqual([{ key: 'tx:gold-1', received: 9_000_000 }])
  })

  it('does not render the form before the server has said what the goal holds', async () => {
    let release: (v: unknown) => void = () => {}
    const pending = new Promise((r) => { release = r })
    fetchMock.mockImplementation(async () => { await pending; return { ok: true, json: async () => ({ blockers: [], holdings: SERVER_HOLDINGS, completed: false }) } })
    mountSheet()
    expect(screen.queryByTestId('finish-goal-confirm')).not.toBeInTheDocument()
    release(null)
    await waitFor(() => expect(screen.getByTestId('finish-goal-confirm')).toBeInTheDocument())
  })

  it('lets a goal with nothing left be archived', async () => {
    // The user withdrew everything by hand; finishing is now purely the archive.
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => (
      init?.method === 'POST'
        ? { ok: true, json: async () => ({ realized: 0, holdings: 0 }) }
        : { ok: true, json: async () => ({ blockers: [], holdings: [], completed: false }) }
    ))
    mountSheet({ rows: [] })
    await waitFor(() => expect(screen.getByTestId('finish-goal-confirm')).toBeEnabled())
    expect(screen.getByText(/holds nothing left/)).toBeInTheDocument()
  })

  it('leaves a recurring saving out of the liquidation list', async () => {
    // It is a plan definition with no transaction to sell — the server does not
    // enumerate it, and the blocker check is what stops the finish.
    fetchMock.mockImplementation(async () => ({
      ok: true, json: async () => ({ blockers: [], holdings: [], completed: false }),
    }))
    mountSheet({ rows: [row({ id: 'recurring:s1', name: 'Monthly transfer', isRecurring: true })] })
    await waitFor(() => expect(screen.getByTestId('finish-goal-confirm')).toBeInTheDocument())
    expect(screen.queryByText('Monthly transfer')).not.toBeInTheDocument()
  })
})
