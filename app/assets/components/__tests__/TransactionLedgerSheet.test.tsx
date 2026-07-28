import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import TransactionLedgerSheet from '../TransactionLedgerSheet'

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}))
// Nested sheets fetch/render on their own; stub them so this test only exercises
// the ledger rows.
vi.mock('../AddTransactionSheet', () => ({ default: () => null }))
const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m) } }))

// The ledger ("Xem tất cả") shares txKind with the Recent activity card and the
// goal-detail History tab. A held-for-merge settlement is parked cash, not a spend,
// so it must read neutrally here too — never the red "−" of a withdrawal. This locks
// that the LEDGER calls txKind at render time (a logic-only txKind test can't).
// (t mock returns the key, so the direction label == the i18n key.)
describe('TransactionLedgerSheet — held-for-merge rows read neutrally', () => {
  const base = {
    asset_type: 'bank', investment_date: '2026-06-01', amount_vnd: 10_000_000,
    savings_goals: { goal_name: 'House' },
  }
  const heldTx = { ...base, transaction_id: 'h1', transaction_type: 'withdrawal', held_for_merge: true, consumed_by_inv_id: null }
  const withdrawTx = { ...base, transaction_id: 'w1', transaction_type: 'withdrawal' }

  const mockTxs = (list: unknown[]) => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('savings-goals')) return Promise.resolve({ ok: true, json: async () => ({ goals: [] }) })
      if (url.includes('/api/funds')) return Promise.resolve({ ok: true, json: async () => ({ funds: [] }) })
      if (url.includes('investment-transactions')) return Promise.resolve({ ok: true, json: async () => ({ transactions: list, total: list.length }) })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
  }

  beforeEach(() => { mockTxs([]) })

  const props = { open: true, desktop: true, locale: 'en', onClose: vi.fn() }

  it('a held settlement reads as "held" with no minus sign', async () => {
    mockTxs([heldTx])
    render(<TransactionLedgerSheet {...props} />)
    const row = await screen.findByTestId('tx-ledger-row')
    expect(screen.getByText('held')).toBeInTheDocument()
    expect(screen.queryByText('withdrawal')).toBeNull()
    expect(row.textContent).not.toContain('−')
  })

  it('a plain withdrawal still reads as a red "−" (so the neutral assertion is not vacuous)', async () => {
    mockTxs([withdrawTx])
    render(<TransactionLedgerSheet {...props} />)
    const row = await screen.findByTestId('tx-ledger-row')
    expect(screen.getByText('withdrawal')).toBeInTheDocument()
    expect(row.textContent).toContain('−')
  })

  it('gives the row edit/delete buttons a ≥44px touch target', async () => {
    mockTxs([{ ...base, transaction_id: 'd1', transaction_type: 'deposit' }])
    render(<TransactionLedgerSheet {...props} />)

    const del = await screen.findByTestId('tx-ledger-delete')
    expect(parseFloat(del.style.minWidth)).toBeGreaterThanOrEqual(44)
    expect(parseFloat(del.style.minHeight)).toBeGreaterThanOrEqual(44)

    const edit = screen.getByRole('button', { name: 'edit' })
    expect(parseFloat(edit.style.minWidth)).toBeGreaterThanOrEqual(44)
    expect(parseFloat(edit.style.minHeight)).toBeGreaterThanOrEqual(44)
  })
})

// A refused delete used to do nothing at all: handleDelete checked res.ok with
// no else, so the dialog sat there and the row stayed put with no explanation
// (#550). The message is looked up by the server's `code`, which the mocked
// translator echoes back — so asserting on the code proves the right reason was
// chosen, not merely that *some* toast fired.
describe('TransactionLedgerSheet — a refused delete says why', () => {
  const tx = {
    transaction_id: 'x1', asset_type: 'bank', investment_date: '2026-06-01',
    amount_vnd: 10_000_000, transaction_type: 'investment',
    savings_goals: { goal_name: 'House' },
  }

  function mockWithDelete(deleteResponse: { ok: boolean; status?: number; body?: unknown }) {
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return Promise.resolve({
          ok: deleteResponse.ok,
          status: deleteResponse.status ?? 200,
          json: async () => deleteResponse.body ?? {},
        })
      }
      if (url.includes('savings-goals')) return Promise.resolve({ ok: true, json: async () => ({ goals: [] }) })
      if (url.includes('/api/funds')) return Promise.resolve({ ok: true, json: async () => ({ funds: [] }) })
      if (url.includes('investment-transactions')) return Promise.resolve({ ok: true, json: async () => ({ transactions: [tx], total: 1 }) })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
  }

  beforeEach(() => { toastError.mockClear() })

  it.each([
    ['settlement_consumed'],
    ['settlement_pending'],
    ['merge_target'],
  ])('surfaces the %s refusal', async (code) => {
    mockWithDelete({ ok: false, status: 409, body: { error: 'nope', code } })
    render(<TransactionLedgerSheet open desktop locale="en" onClose={() => {}} />)

    const del = await screen.findByTestId('tx-ledger-delete')
    del.click()
    const confirm = await screen.findByTestId('tx-ledger-delete-confirm')
    confirm.click()

    await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith(code))
  })

  it('says nothing when the delete succeeds', async () => {
    mockWithDelete({ ok: true, body: { message: 'Transaction deleted.' } })
    render(<TransactionLedgerSheet open desktop locale="en" onClose={() => {}} />)

    const del = await screen.findByTestId('tx-ledger-delete')
    del.click()
    const confirm = await screen.findByTestId('tx-ledger-delete-confirm')
    confirm.click()

    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(toastError).not.toHaveBeenCalled()
  })
})

// not_found isn't an ordinary refusal — the row really is gone (a stale tab, or
// another surface deleted it). Toasting and leaving it on screen means every
// retry hits the same 404 against a row that only exists in this render.
describe('TransactionLedgerSheet — a not_found delete reconciles the list', () => {
  const tx = {
    transaction_id: 'x1', asset_type: 'bank', investment_date: '2026-06-01',
    amount_vnd: 10_000_000, transaction_type: 'investment',
    savings_goals: { goal_name: 'House' },
  }

  it('refetches and notifies the parent, so the stale row disappears', async () => {
    let listCalls = 0
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'gone', code: 'not_found' }) })
      }
      if (url.includes('savings-goals')) return Promise.resolve({ ok: true, json: async () => ({ goals: [] }) })
      if (url.includes('/api/funds')) return Promise.resolve({ ok: true, json: async () => ({ funds: [] }) })
      if (url.includes('investment-transactions')) {
        listCalls++
        // Gone on the refetch — the server's view, which the UI must adopt.
        const list = listCalls === 1 ? [tx] : []
        return Promise.resolve({ ok: true, json: async () => ({ transactions: list, total: list.length }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    const onChanged = vi.fn()
    render(<TransactionLedgerSheet open desktop locale="en" onClose={() => {}} onChanged={onChanged} />)

    const del = await screen.findByTestId('tx-ledger-delete')
    del.click()
    const confirm = await screen.findByTestId('tx-ledger-delete-confirm')
    confirm.click()

    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(listCalls).toBeGreaterThan(1)
    await vi.waitFor(() => expect(screen.queryByTestId('tx-ledger-delete')).toBeNull())
  })
})

