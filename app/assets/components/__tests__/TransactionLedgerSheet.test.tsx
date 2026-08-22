import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import TransactionLedgerSheet from '../TransactionLedgerSheet'

// Keys pass through, but interpolated values come with them — a message whose
// whole job is to name something (the savings a delete would unlink, #655) is
// untestable if the mock throws the params away.
vi.mock('next-intl', () => ({
  useTranslations: () => (k: string, params?: Record<string, unknown>) =>
    params ? `${k}:${JSON.stringify(params)}` : k,
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
    ['withdrawal_invariant'],
  ])('surfaces the %s refusal', async (code) => {
    mockWithDelete({ ok: false, status: 409, body: { error: 'nope', code } })
    render(<TransactionLedgerSheet open desktop locale="en" onClose={() => {}} />)

    const del = await screen.findByTestId('tx-ledger-delete')
    del.click()
    // Delete is held until the unlink lookup settles (#655), so a click fired
    // the instant the dialog appears lands on a disabled button.
    const confirm = await screen.findByTestId('tx-ledger-delete-confirm')
    await vi.waitFor(() => expect(confirm).toBeEnabled())
    confirm.click()

    await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith(code))
  })

  it('says nothing when the delete succeeds', async () => {
    mockWithDelete({ ok: true, body: { message: 'Transaction deleted.' } })
    render(<TransactionLedgerSheet open desktop locale="en" onClose={() => {}} />)

    const del = await screen.findByTestId('tx-ledger-delete')
    del.click()
    // Delete is held until the unlink lookup settles (#655), so a click fired
    // the instant the dialog appears lands on a disabled button.
    const confirm = await screen.findByTestId('tx-ledger-delete-confirm')
    await vi.waitFor(() => expect(confirm).toBeEnabled())
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
    // Delete is held until the unlink lookup settles (#655), so a click fired
    // the instant the dialog appears lands on a disabled button.
    const confirm = await screen.findByTestId('tx-ledger-delete-confirm')
    await vi.waitFor(() => expect(confirm).toBeEnabled())
    confirm.click()

    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(listCalls).toBeGreaterThan(1)
    await vi.waitFor(() => expect(screen.queryByTestId('tx-ledger-delete')).toBeNull())
  })
})

// Deleting a deposit a recurring saving feeds unlinks that saving on the way out
// (ON DELETE SET NULL) and says nothing (#655). The plan then stops routing
// money into a book while its monthly line still reads healthy. The delete stays
// allowed — it is the user's deposit — but the confirm dialog is the last moment
// they can decide knowing that, so it names the savings at stake.
describe('TransactionLedgerSheet — deleting a deposit a recurring saving feeds', () => {
  const tx = {
    transaction_id: 'd1', asset_type: 'bank', investment_date: '2026-06-01',
    amount_vnd: 10_000_000, transaction_type: 'investment',
    savings_goals: { goal_name: 'House' },
  }

  const mockWithSavings = (savings: unknown[]) => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('recurring-savings')) return Promise.resolve({ ok: true, json: async () => ({ savings }) })
      if (url.includes('savings-goals')) return Promise.resolve({ ok: true, json: async () => ({ goals: [] }) })
      if (url.includes('/api/funds')) return Promise.resolve({ ok: true, json: async () => ({ funds: [] }) })
      if (url.includes('investment-transactions')) return Promise.resolve({ ok: true, json: async () => ({ transactions: [tx], total: 1 }) })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
  }

  it('names the saving that would lose its link', async () => {
    mockWithSavings([{ saving_id: 'rs1', name: 'VCB Savings', linked_deposit_tx_id: 'd1' }])
    render(<TransactionLedgerSheet open desktop locale="en" onClose={() => {}} />)

    const del = await screen.findByTestId('tx-ledger-delete')
    del.click()
    const warning = await screen.findByTestId('tx-delete-unlinks-savings')
    expect(warning.textContent).toContain('VCB Savings')
  })

  it('stays quiet when the savings point at other deposits', async () => {
    mockWithSavings([{ saving_id: 'rs1', name: 'VCB Savings', linked_deposit_tx_id: 'other-tx' }])
    render(<TransactionLedgerSheet open desktop locale="en" onClose={() => {}} />)

    const del = await screen.findByTestId('tx-ledger-delete')
    del.click()
    await screen.findByTestId('tx-ledger-delete-confirm')
    expect(screen.queryByTestId('tx-delete-unlinks-savings')).toBeNull()
  })

  // The warning is advisory: if the lookup fails there is still a delete to
  // perform, and blocking it would turn a missing sentence into a dead button.
  it('still offers the delete when the lookup fails', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('recurring-savings')) return Promise.reject(new Error('offline'))
      if (url.includes('savings-goals')) return Promise.resolve({ ok: true, json: async () => ({ goals: [] }) })
      if (url.includes('/api/funds')) return Promise.resolve({ ok: true, json: async () => ({ funds: [] }) })
      if (url.includes('investment-transactions')) return Promise.resolve({ ok: true, json: async () => ({ transactions: [tx], total: 1 }) })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    render(<TransactionLedgerSheet open desktop locale="en" onClose={() => {}} />)

    const del = await screen.findByTestId('tx-ledger-delete')
    del.click()
    expect(await screen.findByTestId('tx-ledger-delete-confirm')).toBeInTheDocument()
    expect(screen.queryByTestId('tx-delete-unlinks-savings')).toBeNull()
  })

  // Only a bank deposit can carry a recurring link at all — the link validator
  // accepts nothing else. Asking about a fund, gold or a withdrawal buys a
  // guaranteed-empty answer and, now that Delete waits for it, a delay on every
  // unrelated deletion.
  it('does not ask about a holding that could never carry a link', async () => {
    const fund = { ...tx, transaction_id: 'f1', asset_type: 'fund' }
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('savings-goals')) return Promise.resolve({ ok: true, json: async () => ({ goals: [] }) })
      if (url.includes('/api/funds')) return Promise.resolve({ ok: true, json: async () => ({ funds: [] }) })
      if (url.includes('investment-transactions')) return Promise.resolve({ ok: true, json: async () => ({ transactions: [fund], total: 1 }) })
      if (url.includes('recurring-savings')) return new Promise(() => {})  // never answers
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    render(<TransactionLedgerSheet open desktop locale="en" onClose={() => {}} />)

    const del = await screen.findByTestId('tx-ledger-delete')
    del.click()

    // Enabled straight away: a hung lookup cannot be what it is waiting on,
    // because it was never started.
    expect(await screen.findByTestId('tx-ledger-delete-confirm')).toBeEnabled()
    const asked = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
      .some((c) => String(c[0]).includes('recurring-savings'))
    expect(asked).toBe(false)
  })

  it('skips a bank withdrawal too, which no link can point at', async () => {
    const withdrawal = { ...tx, transaction_id: 'w1', transaction_type: 'withdrawal' }
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('savings-goals')) return Promise.resolve({ ok: true, json: async () => ({ goals: [] }) })
      if (url.includes('/api/funds')) return Promise.resolve({ ok: true, json: async () => ({ funds: [] }) })
      if (url.includes('investment-transactions')) return Promise.resolve({ ok: true, json: async () => ({ transactions: [withdrawal], total: 1 }) })
      if (url.includes('recurring-savings')) return new Promise(() => {})
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    render(<TransactionLedgerSheet open desktop locale="en" onClose={() => {}} />)

    const del = await screen.findByTestId('tx-ledger-delete')
    del.click()
    expect(await screen.findByTestId('tx-ledger-delete-confirm')).toBeEnabled()
  })

  // A warning that arrives after the user has confirmed is not a warning. The
  // dialog opens the instant the button is pressed, so on a slow lookup the
  // Delete button would be live with nothing shown next to it — the exact
  // outcome this change exists to prevent.
  it('does not accept a confirmation until the lookup has settled', async () => {
    let release: (v: unknown) => void = () => {}
    const pending = new Promise((resolve) => { release = resolve })
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('recurring-savings')) return pending
      if (url.includes('savings-goals')) return Promise.resolve({ ok: true, json: async () => ({ goals: [] }) })
      if (url.includes('/api/funds')) return Promise.resolve({ ok: true, json: async () => ({ funds: [] }) })
      if (url.includes('investment-transactions')) return Promise.resolve({ ok: true, json: async () => ({ transactions: [tx], total: 1 }) })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    render(<TransactionLedgerSheet open desktop locale="en" onClose={() => {}} />)

    const del = await screen.findByTestId('tx-ledger-delete')
    del.click()
    const confirm = await screen.findByTestId('tx-ledger-delete-confirm')
    expect(confirm).toBeDisabled()

    release({ ok: true, json: async () => ({ savings: [{ saving_id: 'rs1', name: 'VCB Savings', linked_deposit_tx_id: 'd1' }] }) })
    await screen.findByTestId('tx-delete-unlinks-savings')
    await vi.waitFor(() => expect(screen.getByTestId('tx-ledger-delete-confirm')).toBeEnabled())
  })

  // Cancel one dialog, open another, and the first lookup lands late: without a
  // check that it still describes the transaction on screen, the second deposit
  // gets told it funds savings that belong to the first.
  it('drops a lookup that no longer describes the open dialog', async () => {
    const second = { ...tx, transaction_id: 'd2' }
    let release: (v: unknown) => void = () => {}
    const pending = new Promise((resolve) => { release = resolve })
    let lookups = 0
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('recurring-savings')) {
        lookups += 1
        return lookups === 1 ? pending : Promise.resolve({ ok: true, json: async () => ({ savings: [] }) })
      }
      if (url.includes('savings-goals')) return Promise.resolve({ ok: true, json: async () => ({ goals: [] }) })
      if (url.includes('/api/funds')) return Promise.resolve({ ok: true, json: async () => ({ funds: [] }) })
      if (url.includes('investment-transactions')) return Promise.resolve({ ok: true, json: async () => ({ transactions: [tx, second], total: 2 }) })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    render(<TransactionLedgerSheet open desktop locale="en" onClose={() => {}} />)

    const rows = await screen.findAllByTestId('tx-ledger-delete')
    rows[0].click()                                   // d1 — lookup hangs
    await screen.findByTestId('tx-ledger-delete-confirm')
    screen.getByText('cancel').click()
    await vi.waitFor(() => expect(screen.queryByTestId('tx-ledger-delete-confirm')).toBeNull())

    rows[1].click()                                   // d2 — lookup answers empty
    await vi.waitFor(() => expect(screen.getByTestId('tx-ledger-delete-confirm')).toBeEnabled())

    // d1's answer arrives now, naming a saving that has nothing to do with d2.
    // Awaiting the very promise the component is suspended on hands its
    // continuation to the microtask queue before the assertion runs — the test
    // above proves a late answer does reach the dialog, so a silent one here is
    // the guard working rather than nothing having happened yet.
    release({ ok: true, json: async () => ({ savings: [{ saving_id: 'rs1', name: 'VCB Savings', linked_deposit_tx_id: 'd1' }] }) })
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('tx-delete-unlinks-savings')).toBeNull()
  })
})

// A transaction that belongs to a finished goal stays editable for its notes
// (#650) — but the goal picker only lists ACTIVE goals, so the row's own goal
// had no option to select and the controlled select fell back to showing
// "No goal". The form still held the completed id and would send it back on
// save, so the screen contradicted what was stored. The row's own goal must be
// shown (and locked), while other finished goals stay out as targets.
describe('TransactionLedgerSheet — editing a transaction under a finished goal', () => {
  const goals = [
    { goal_id: 'g-active', goal_name: 'Emergency', completed_at: null },
    { goal_id: 'g-done', goal_name: 'House', completed_at: '2026-08-01T00:00:00Z' },
    { goal_id: 'g-other-done', goal_name: 'Car', completed_at: '2026-07-01T00:00:00Z' },
  ]
  // Stock is the asset type the ledger edits in its OWN inline form; every other
  // type is handed to AddTransactionSheet (which has its own picker, tested there).
  const tx = {
    transaction_id: 't1', asset_type: 'stock', investment_date: '2026-06-01',
    amount_vnd: 10_000_000, transaction_type: 'deposit', goal_id: 'g-done',
    savings_goals: { goal_name: 'House' },
  }

  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('savings-goals')) return Promise.resolve({ ok: true, json: async () => ({ goals }) })
      if (url.includes('/api/funds')) return Promise.resolve({ ok: true, json: async () => ({ funds: [] }) })
      if (url.includes('investment-transactions')) return Promise.resolve({ ok: true, json: async () => ({ transactions: [tx], total: 1 }) })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
  })

  it('shows the finished goal it is filed under instead of "No goal"', async () => {
    render(<TransactionLedgerSheet open desktop locale="en" onClose={() => {}} />)
    ;(await screen.findByRole('button', { name: 'edit' })).click()

    const select = await screen.findByTestId('ledger-goal-select')
    expect((select as HTMLSelectElement).value).toBe('g-done')
    expect(within(select).getByRole('option', { name: 'House' })).toBeDisabled()
  })

  it('still refuses every other finished goal as a destination', async () => {
    render(<TransactionLedgerSheet open desktop locale="en" onClose={() => {}} />)
    ;(await screen.findByRole('button', { name: 'edit' })).click()

    const select = await screen.findByTestId('ledger-goal-select')
    expect(within(select).getByRole('option', { name: 'Emergency' })).toBeEnabled()
    expect(within(select).queryByRole('option', { name: 'Car' })).toBeNull()
  })
})


// #705: a recorded withdrawal had NO edit affordance at all — the row offered
// only delete — so a mistyped "số tiền nhận được" (the cash the bank actually
// paid, stored as the withdrawal's amount_vnd) could only be fixed by deleting
// the withdrawal and recording it again. The edit is deliberately narrow: the
// cash received, the date and the notes. Principal withdrawn, the parent holding
// and the asset type are what the withdrawal *claims* against its source — the
// DB invariants measure those — so they stay out of this form.
describe('TransactionLedgerSheet — a recorded withdrawal can have its received amount corrected (#705)', () => {
  const base = {
    asset_type: 'bank', investment_date: '2026-06-01', amount_vnd: 10_000_000,
    savings_goals: { goal_name: 'House' },
  }
  const withdrawTx = { ...base, transaction_id: 'w1', transaction_type: 'withdrawal', notes: 'early close' }
  const heldTx = { ...base, transaction_id: 'h1', transaction_type: 'withdrawal', held_for_merge: true }

  let putCalls: { url: string; body: Record<string, unknown> }[]

  function mockTxs(list: unknown[]) {
    putCalls = []
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        putCalls.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve({ ok: true, json: async () => ({}) })
      }
      if (url.includes('savings-goals')) return Promise.resolve({ ok: true, json: async () => ({ goals: [] }) })
      if (url.includes('/api/funds')) return Promise.resolve({ ok: true, json: async () => ({ funds: [] }) })
      if (url.includes('investment-transactions')) return Promise.resolve({ ok: true, json: async () => ({ transactions: list, total: list.length }) })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
  }

  const props = { open: true, desktop: true, locale: 'en', onClose: vi.fn() }

  it('opens a received-amount form prefilled from the row and PUTs only the fields it owns', async () => {
    mockTxs([withdrawTx])
    render(<TransactionLedgerSheet {...props} />)

    const edit = await screen.findByTestId('tx-ledger-withdraw-edit')
    edit.click()

    const received = await screen.findByTestId('withdraw-received-input') as HTMLInputElement
    expect(received.value).toBe('10.000.000')

    fireEvent.change(received, { target: { value: '9.750.000' } })
    screen.getByTestId('withdraw-edit-save').click()

    await vi.waitFor(() => expect(putCalls).toHaveLength(1))
    expect(putCalls[0].url).toBe('/api/v1/investment-transactions/w1')
    expect(putCalls[0].body).toEqual({
      amount_vnd: 9_750_000,
      investment_date: '2026-06-01',
      notes: 'early close',
    })
  })

  it('leaves a held-for-merge settlement uneditable — its cash is a claim on the merge pool', async () => {
    mockTxs([heldTx])
    render(<TransactionLedgerSheet {...props} />)

    await screen.findByTestId('tx-ledger-row')
    expect(screen.queryByTestId('tx-ledger-withdraw-edit')).toBeNull()
  })
})
