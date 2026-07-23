import { describe, it, expect, vi, beforeEach } from 'vitest'

const { toastErrorMock } = vi.hoisted(() => ({ toastErrorMock: vi.fn() }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: toastErrorMock, success: vi.fn() }) }))

import { usePlanningActions, buildBuyEdit, buildContributionPrefill } from '../usePlanningActions'
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
  const actions = usePlanningActions({ plan, month: 6, year: 2026, isVI: false, onRefresh, onToast, ...overrides })
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

  describe('probeRecurringRecord', () => {
    const item = { recurringId: 'r1', linkedDepositTxId: 'tx1', name: 'Save', amount: 1_000_000 } as GoalItem

    it('returns a book top-up target for a live accumulating book', async () => {
      setup()
      mockFetch(() => ({ ok: true, body: { transaction_id: 'tx1', deposit_group_id: 'tx1', expiry_date: '2999-01-01', interest_rate: 6, notes: 'My book' } }))
      const { actions } = setup()
      const r = await actions.probeRecurringRecord(item)
      expect(r.kind).toBe('book-topup')
      if (r.kind === 'book-topup') {
        expect(r.target.bookId).toBe('tx1')
        expect(r.target.savingId).toBe('r1')
        expect(r.target.ym).toBe('2026-06')
      }
    })

    it('toasts and returns matured for a matured book', async () => {
      const { actions, onToast } = setup()
      mockFetch(() => ({ ok: true, body: { transaction_id: 'tx1', deposit_group_id: 'tx1', expiry_date: '2000-01-01' } }))
      const r = await actions.probeRecurringRecord(item)
      expect(r.kind).toBe('matured')
      expect(onToast).toHaveBeenCalled()
    })

    it('falls back to a standalone contribution when there is no linked book', async () => {
      const { actions } = setup()
      const r = await actions.probeRecurringRecord({ recurringId: 'r1', name: 'Save', amount: 1 } as GoalItem)
      expect(r.kind).toBe('contribution')
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
  })
})
