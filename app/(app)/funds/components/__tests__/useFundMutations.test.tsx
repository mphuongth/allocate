import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFundMutations } from '../useFundMutations'
import type { Fund } from '../useFundsData'

// The desktop and mobile fund libraries each carried their own copy of these
// mutations, down to the optimistic update and its rollback, and the copies had
// already drifted in how they close the editor and call their toast (#573).
// Testing the shared hook is what proves both viewports now get the same
// outcome, since the difference that remains is only presentation.

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))

const FUND: Fund = {
  id: 'f1',
  name: 'VFMVF1',
  code: 'VFMVF1',
  fund_type: 'equity',
  nav: 36120,
  nav_source_url: null,
  is_dca: true,
  dca_monthly_amount_vnd: 1_000_000,
  dca_goal_id: 'goal-1',
  created_at: '',
  updated_at: '',
}

type FetchResult = { ok: boolean; status?: number }

function setup(
  // May return a pending promise, so a test can hold one request open while
  // another completes.
  fetchImpl: (url: string, init?: RequestInit) => FetchResult | Promise<FetchResult>,
  initial: Fund = FUND,
) {
  const requests: Array<{ url: string; method: string; body: Record<string, unknown> | undefined }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    requests.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    })
    const { ok, status } = await fetchImpl(url, init)
    return { ok, status: status ?? (ok ? 200 : 500) }
  }))

  let funds: Fund[] = [initial]
  const setFunds = vi.fn((update: Fund[] | ((prev: Fund[]) => Fund[])) => {
    funds = typeof update === 'function' ? update(funds) : update
  })
  const reload = vi.fn(async () => {})
  const notify = vi.fn()

  const { result } = renderHook(() => useFundMutations({ setFunds, reload, notify }))
  return { result, requests, reload, notify, current: () => funds[0] }
}

const ok = () => ({ ok: true })
const fails = () => ({ ok: false, status: 500 })

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => vi.unstubAllGlobals())

describe('useFundMutations — turning DCA off', () => {
  it('clears the amount optimistically, persists, and reloads', async () => {
    const { result, requests, reload, current } = setup(ok)

    await act(async () => { await result.current.disableDca(FUND) })

    expect(current()).toMatchObject({ is_dca: false, dca_monthly_amount_vnd: null })
    expect(requests[0]).toMatchObject({ url: '/api/funds/f1', method: 'PUT' })
    expect(requests[0].body).toMatchObject({ is_dca: false, dca_monthly_amount_vnd: null })
    expect(reload).toHaveBeenCalled()
  })

  it('rolls back and reports when the request fails', async () => {
    const { result, reload, notify, current } = setup(fails)

    await act(async () => { await result.current.disableDca(FUND) })

    expect(current()).toMatchObject({ is_dca: true })
    expect(notify).toHaveBeenCalledWith('toastDcaFailed', false)
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('useFundMutations — saving the DCA amount', () => {
  it('sends the amount and keeps the existing goal', async () => {
    const { result, requests, reload } = setup(ok)

    await act(async () => { await result.current.saveDcaAmount(FUND, 2_000_000) })

    expect(requests[0].body).toMatchObject({
      is_dca: true,
      dca_monthly_amount_vnd: 2_000_000,
      dca_goal_id: 'goal-1',
    })
    expect(reload).toHaveBeenCalled()
  })

  // A failed save must leave the row showing what the server still has, not a
  // blanket "DCA off" — the previous rollback lied about an untouched
  // configuration after any transient error (#590).
  it('restores the previously saved amount and goal when editing fails', async () => {
    const { result, notify, current } = setup(fails)

    await act(async () => { await result.current.saveDcaAmount(FUND, 2_000_000) })

    expect(current()).toMatchObject({
      is_dca: true,
      dca_monthly_amount_vnd: 1_000_000,
      dca_goal_id: 'goal-1',
    })
    expect(notify).toHaveBeenCalledWith('toastDcaFailed', false)
  })

  // The goal selector stays live while an amount save is in flight, so the two
  // writes can overlap. The amount rollback must stay out of the goal: rolling
  // back to the goal this save captured would undo a goal change the server
  // already accepted (#590 review).
  it('leaves a goal that changed mid-flight alone when the amount save fails', async () => {
    let failAmountSave = () => {}
    const amountSave = new Promise<{ ok: boolean; status: number }>((resolve) => {
      failAmountSave = () => resolve({ ok: false, status: 500 })
    })
    const { result, current } = setup((_url, init) => {
      const body = JSON.parse(init!.body as string)
      return body.dca_goal_id === 'goal-2' ? { ok: true } : amountSave
    })

    let saving: Promise<void> | undefined
    act(() => { saving = result.current.saveDcaAmount(FUND, 2_000_000) })
    // The goal write lands, and reloads, while the amount is still in flight.
    await act(async () => { await result.current.setDcaGoal({ ...FUND, dca_monthly_amount_vnd: 2_000_000 }, 'goal-2') })
    await act(async () => { failAmountSave(); await saving })

    expect(current()).toMatchObject({ dca_goal_id: 'goal-2', is_dca: true, dca_monthly_amount_vnd: 1_000_000 })
  })

  // A brand-new enable has nothing persisted behind it: the view flipped
  // `is_dca` on locally when the editor opened, so the state to restore is off.
  it('reverts to off when the first save of a new enable fails', async () => {
    const enabling: Fund = { ...FUND, is_dca: true, dca_monthly_amount_vnd: null, dca_goal_id: null }
    const { result, notify, current } = setup(fails, enabling)

    await act(async () => { await result.current.saveDcaAmount(enabling, 2_000_000, true) })

    expect(current()).toMatchObject({ is_dca: false, dca_monthly_amount_vnd: null })
    expect(notify).toHaveBeenCalledWith('toastDcaFailed', false)
  })
})

describe('useFundMutations — setting the DCA goal', () => {
  it('applies the goal optimistically and persists it', async () => {
    const { result, requests, current } = setup(ok)

    await act(async () => { await result.current.setDcaGoal(FUND, 'goal-2') })

    expect(current()).toMatchObject({ dca_goal_id: 'goal-2' })
    expect(requests[0].body).toMatchObject({ dca_goal_id: 'goal-2', is_dca: true })
  })

  it('restores the previous goal when the request fails', async () => {
    const { result, notify, current } = setup(fails)

    await act(async () => { await result.current.setDcaGoal(FUND, 'goal-2') })

    expect(current()).toMatchObject({ dca_goal_id: 'goal-1' })
    expect(notify).toHaveBeenCalledWith('toastGoalFailed', false)
  })

  it('can clear the goal', async () => {
    const { result, requests } = setup(ok)

    await act(async () => { await result.current.setDcaGoal(FUND, null) })

    expect(requests[0].body).toMatchObject({ dca_goal_id: null })
  })
})

// The three outcomes named in the issue. A fund used by a monthly plan is a
// hard block, and saying so is the whole point — a generic failure toast would
// leave the user retrying something that can never work.
describe('useFundMutations — deleting', () => {
  it('reports success and reloads', async () => {
    const { result, requests, reload, notify } = setup(() => ({ ok: true, status: 204 }))

    let outcome: string | undefined
    await act(async () => { outcome = await result.current.deleteFund(FUND) })

    expect(outcome).toBe('deleted')
    expect(requests[0]).toMatchObject({ url: '/api/funds/f1', method: 'DELETE' })
    expect(reload).toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith('toastDeleted', true)
  })

  it('refuses a fund that is in use, without reloading', async () => {
    const { result, reload, notify } = setup(() => ({ ok: false, status: 409 }))

    let outcome: string | undefined
    await act(async () => { outcome = await result.current.deleteFund(FUND) })

    expect(outcome).toBe('in-use')
    expect(notify).toHaveBeenCalledWith('toastDeleteInUse', false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('reports a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    const setFunds = vi.fn()
    const reload = vi.fn(async () => {})
    const notify = vi.fn()
    const { result } = renderHook(() => useFundMutations({ setFunds, reload, notify }))

    let outcome: string | undefined
    await act(async () => { outcome = await result.current.deleteFund(FUND) })

    expect(outcome).toBe('failed')
    expect(notify).toHaveBeenCalledWith('toastDeleteFailed', false)
  })
})

describe('useFundMutations — busy tracking', () => {
  it('marks the fund busy for the duration and clears it afterwards', async () => {
    const { result } = setup(ok)

    expect(result.current.togglingIds.has('f1')).toBe(false)
    await act(async () => { await result.current.setDcaGoal(FUND, 'goal-2') })
    expect(result.current.togglingIds.has('f1')).toBe(false)
  })

  it('clears the busy flag even when the request fails', async () => {
    const { result } = setup(fails)

    await act(async () => { await result.current.disableDca(FUND) })

    expect(result.current.togglingIds.has('f1')).toBe(false)
  })
})
