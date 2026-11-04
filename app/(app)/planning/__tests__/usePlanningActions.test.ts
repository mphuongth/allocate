import { describe, it, expect, vi, beforeEach } from 'vitest'

const { toastErrorMock } = vi.hoisted(() => ({ toastErrorMock: vi.fn() }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: toastErrorMock, success: vi.fn() }) }))

import { usePlanningActions, buildBuyEdit, buildContributionPrefill, pendingRecurringOf, depositToast, buildRecordContext } from '../usePlanningActions'
import type { GoalItem } from '@/lib/planning'

// usePlanningActions uses no React hooks internally — it returns plain async
// functions — so it can be exercised directly. It's the single implementation
// both planning views now call, so these cases pin mobile/desktop parity (#467).

const plan = { id: 'plan-1', month: 6, year: 2026, salary_vnd: 30_000_000 }

function setup(overrides: Partial<Parameters<typeof usePlanningActions>[0]> = {}) {
  const onRefresh = vi.fn()
  const onToast = vi.fn()
  // usePlanningActions has no React-hook internals — it returns plain async
  // functions — so it's safe to call outside a component in this test.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const actions = usePlanningActions({ plan, isVI: false, onRefresh, onToast, ...overrides })
  return { actions, onRefresh, onToast }
}

function mockFetch(handler: (url: string, init?: RequestInit) => { ok: boolean; body?: unknown }) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, init })
    const r = handler(u, init)
    return { ok: r.ok, json: async () => r.body ?? {} } as Response
  }) as unknown as typeof fetch
  return calls
}

beforeEach(() => {
  toastErrorMock.mockClear()
  vi.restoreAllMocks()
})

describe('usePlanningActions (#467 shared planning actions)', () => {
  it('skipFixedExpense POSTs an amount-0 override and reports success', async () => {
    const { actions, onRefresh, onToast } = setup()
    const calls = mockFetch(() => ({ ok: true }))
    await actions.skipFixedExpense({ expense_id: 'fe1', expense_name: 'Rent', amount_vnd: 1_000_000 } as never)
    expect(calls[0].url).toBe('/api/v1/monthly-plans/plan-1/fixed-expense-overrides')
    expect(calls[0].init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ fixed_expense_id: 'fe1', monthly_amount_override_vnd: 0 })
    expect(onRefresh).toHaveBeenCalled()
    expect(onToast).toHaveBeenCalledWith('Skipped Rent')
  })

  it('restoreFixedExpense deletes the matching override', async () => {
    const { actions, onToast } = setup()
    const calls = mockFetch((url, init) => {
      if (init?.method === 'DELETE') return { ok: true }
      return { ok: true, body: [{ id: 'ov1', fixed_expense_id: 'fe1' }] }
    })
    await actions.restoreFixedExpense({ expense_id: 'fe1', expense_name: 'Rent', amount_vnd: 1_000_000 } as never)
    expect(calls.some(c => c.url.endsWith('/fixed-expense-overrides/ov1') && c.init?.method === 'DELETE')).toBe(true)
    expect(onToast).toHaveBeenCalledWith('Restored Rent')
  })

  it('restoreFixedExpense still reports success when there is no override to delete (parity fix)', async () => {
    const { actions, onRefresh, onToast } = setup()
    const calls = mockFetch(() => ({ ok: true, body: [] }))
    await actions.restoreFixedExpense({ expense_id: 'fe1', expense_name: 'Rent', amount_vnd: 1 } as never)
    expect(calls.some(c => c.init?.method === 'DELETE')).toBe(false)
    expect(onRefresh).toHaveBeenCalled()
    expect(onToast).toHaveBeenCalledWith('Restored Rent')
  })

  it('restoreInsurance also clears a lingering per-plan override (parity fix)', async () => {
    const { actions, onToast } = setup()
    const calls = mockFetch((url, init) => {
      if (url.includes('/insurance-overrides') && init?.method !== 'DELETE') return { ok: true, body: [{ id: 'io1', member_id: 'm1' }] }
      return { ok: true }
    })
    await actions.restoreInsurance({ member_id: 'm1', member_name: 'Me' } as never)
    expect(calls.some(c => c.url.endsWith('/excluded-insurance/m1') && c.init?.method === 'DELETE')).toBe(true)
    expect(calls.some(c => c.url.endsWith('/insurance-overrides/io1') && c.init?.method === 'DELETE')).toBe(true)
    expect(onToast).toHaveBeenCalledWith('Restored Me')
  })

  it('restoreInsurance fails (no success toast) when clearing the override errors', async () => {
    const { actions, onRefresh, onToast } = setup()
    mockFetch((url, init) => {
      // Exclusion removal + the overrides GET succeed; the override DELETE fails.
      if (url.includes('/insurance-overrides/') && init?.method === 'DELETE') return { ok: false }
      if (url.includes('/insurance-overrides') && init?.method !== 'DELETE') return { ok: true, body: [{ id: 'io1', member_id: 'm1' }] }
      return { ok: true }
    })
    await actions.restoreInsurance({ member_id: 'm1', member_name: 'Me' } as never)
    expect(toastErrorMock).toHaveBeenCalled()
    expect(onRefresh).not.toHaveBeenCalled()
    expect(onToast).not.toHaveBeenCalled()
  })

  it('saveOverride routes each type to its own endpoint and returns true', async () => {
    const { actions, onToast } = setup()
    const calls = mockFetch(() => ({ ok: true }))
    expect(await actions.saveOverride({ type: 'rec', id: 'r1', amount: 500_000 })).toBe(true)
    expect(calls[0].url).toBe('/api/v1/monthly-plans/plan-1/recurring-saving-overrides')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ recurring_saving_id: 'r1', monthly_amount_override_vnd: 500_000 })
    // Regression guard: a recurring override must NOT hit the insurance endpoint.
    expect(calls.some(c => c.url.includes('/insurance-overrides'))).toBe(false)
    expect(onToast).toHaveBeenCalledWith('Override saved')
  })

  it('a failed write shows an error toast and does not report success', async () => {
    const { actions, onRefresh, onToast } = setup()
    mockFetch(() => ({ ok: false }))
    const ok = await actions.saveOverride({ type: 'fe', id: 'fe1', amount: 100 })
    expect(ok).toBe(false)
    expect(toastErrorMock).toHaveBeenCalled()
    expect(onRefresh).not.toHaveBeenCalled()
    expect(onToast).not.toHaveBeenCalled()
  })

  describe('unparkDca', () => {
    // Undoing "Gửi tiết kiệm thay" is deleting the deposit: the skip goes with
    // it (FK cascade) and the next load asks for the DCA again.
    const parked = {
      name: 'VFMVN30 ETF', type: 'fund', amount: 5_000_000, isFundDca: true, fundId: 'f-e1',
      parkedIn: { transactionId: 'dep-1', name: 'Sổ VCB', amount: 5_000_000 },
    } as GoalItem

    it('deletes the deposit the DCA was parked in and reports it', async () => {
      const { actions, onRefresh, onToast } = setup()
      const calls = mockFetch(() => ({ ok: true }))
      await actions.unparkDca(parked)
      expect(calls).toEqual([{ url: '/api/v1/investment-transactions/dep-1', init: { method: 'DELETE' } }])
      expect(onRefresh).toHaveBeenCalled()
      expect(onToast).toHaveBeenCalledWith('Restored VFMVN30 ETF')
    })

    it("says why when the deposit can't be deleted (e.g. already renewed)", async () => {
      const { actions, onToast } = setup()
      mockFetch(() => ({ ok: false, body: { error: 'This deposit has been renewed and cannot be deleted.' } }))
      await actions.unparkDca(parked)
      expect(toastErrorMock).toHaveBeenCalledWith('This deposit has been renewed and cannot be deleted.')
      expect(onToast).not.toHaveBeenCalled()
    })
  })

  describe('pure builders', () => {
    it('buildBuyEdit maps an investment row to an editable fund transaction', () => {
      const inv = { transaction_id: 't1', investment_date: '2026-06-01', amount_vnd: 2_000_000, unit_price: 20_000, units: 100, fund_id: 'f1', goal_id: 'g1' }
      const e = buildBuyEdit('t1', [inv] as never)
      expect(e).toMatchObject({ transaction_id: 't1', asset_type: 'fund', amount_vnd: 2_000_000, fund_id: 'f1', goal_id: 'g1' })
    })

    it('buildBuyEdit returns null for a missing transaction', () => {
      expect(buildBuyEdit(undefined, [] as never)).toBeNull()
      expect(buildBuyEdit('nope', [] as never)).toBeNull()
    })

    it('buildContributionPrefill nulls the goal for Unallocated and carries the plan id', () => {
      expect(buildContributionPrefill({ goalId: 'g1', isUnallocated: false }, 'plan-1', { asset_type: 'bank', amount_vnd: 500 }))
        .toMatchObject({ goal_id: 'g1', plan_id: 'plan-1', asset_type: 'bank', amount_vnd: 500 })
      expect(buildContributionPrefill({ goalId: 'unalloc', isUnallocated: true }, null).goal_id).toBeNull()
    })

    // What "Record" hands the deposit sheet: which recurring, for which month and
    // plan, and the book it is linked to (if any).
    it('buildRecordContext describes the recurring line for its plan month', () => {
      const item = { recurringId: 's1', name: 'PVcomBank', amount: 3_000_000, linkedDepositTxId: 'b1' } as GoalItem
      expect(buildRecordContext(item, 3, 2026, 'plan-1')).toEqual({ savingId: 's1', name: 'PVcomBank', amount: 3_000_000, ym: '2026-03', planId: 'plan-1', linkedBookId: 'b1' })
      expect(buildRecordContext({ ...item, linkedDepositTxId: null }, 11, 2026, null).linkedBookId).toBeNull()
    })

    // The toast names the book the money went into, not a generic "logged".
    it('depositToast names the book when the deposit went into one', () => {
      expect(depositToast({ amount: 3_000_000, bookName: 'PVcomBank' }, true)).toBe('Đã gửi ₫ 3.000.000 vào PVcomBank')
      expect(depositToast({ amount: 3_000_000, bookName: 'PVcomBank' }, false)).toBe('Deposited ₫ 3.000.000 into PVcomBank')
      expect(depositToast({ amount: 3_000_000, bookName: null }, true)).toBe('Đã ghi nhận đóng góp')
      expect(depositToast(undefined, false)).toBe('Contribution logged')
    })

    // What the sheet warns a same-amount deposit would count as: the goal's
    // recurring lines still waiting this month — not ones already in or skipped.
    it('pendingRecurringOf lists only the recurring lines still to record', () => {
      const items = [
        { name: 'PV', type: 'bank' as const, amount: 3_000_000, isRecurring: true },
        { name: 'Done', type: 'bank' as const, amount: 1_000_000, isRecurring: true, recorded: true },
        { name: 'Skip', type: 'bank' as const, amount: 2_000_000, isRecurring: true, skipped: true },
        { name: 'Fund', type: 'fund' as const, amount: 3_000_000 },
      ]
      expect(pendingRecurringOf({ items })).toEqual([{ name: 'PV', amount: 3_000_000 }])
    })

    // "Add more" on a goal whose plan is all bank savings opens on Bank, not the
    // Fund default — one less tap for the common case (#782).
    it('buildContributionPrefill opens on Bank when every line of the goal is a bank saving', () => {
      const bank = { type: 'bank' as const }, fund = { type: 'fund' as const }
      expect(buildContributionPrefill({ goalId: 'g1', isUnallocated: false, items: [bank, bank] }, null).asset_type).toBe('bank')
      expect(buildContributionPrefill({ goalId: 'g1', isUnallocated: false, items: [bank, fund] }, null).asset_type).toBeUndefined()
      expect(buildContributionPrefill({ goalId: 'g1', isUnallocated: false, items: [] }, null).asset_type).toBeUndefined()
      // An explicit prefill still wins.
      expect(buildContributionPrefill({ goalId: 'g1', isUnallocated: false, items: [bank] }, null, { asset_type: 'gold' }).asset_type).toBe('gold')
    })
  })
})
