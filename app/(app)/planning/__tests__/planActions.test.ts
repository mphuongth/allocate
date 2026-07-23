import { describe, it, expect, vi, afterEach, type Mock } from 'vitest'
import { saveIncome, deletePlan, saveOtherExpense } from '../planActions'

function mockFetch(impl: (url?: string, init?: RequestInit) => Promise<unknown>): Mock {
  const m = vi.fn(impl)
  vi.stubGlobal('fetch', m)
  return m
}
const bodyOf = (m: Mock, i = 0) => JSON.parse((m.mock.calls[i][1] as RequestInit).body as string)

afterEach(() => vi.unstubAllGlobals())

describe('planActions.saveIncome', () => {
  it('creates a plan (POST with month/year/salary) and returns the new plan', async () => {
    const created = { id: 'p1', month: 5, year: 2026, salary_vnd: 45_000_000 }
    const m = mockFetch(() => Promise.resolve({ ok: true, json: () => Promise.resolve(created) }))

    const r = await saveIncome({ planId: null, month: 5, year: 2026, salaryVnd: 45_000_000 })

    expect(m).toHaveBeenCalledWith('/api/v1/monthly-plans', expect.objectContaining({ method: 'POST' }))
    expect(bodyOf(m)).toEqual({ month: 5, year: 2026, salary_vnd: 45_000_000 })
    expect(r).toEqual({ ok: true, data: created })
  })

  it('updates an existing plan (PUT /:id with salary only — no month/year, and not PATCH)', async () => {
    const m = mockFetch(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))

    const r = await saveIncome({ planId: 'p1', month: 5, year: 2026, salaryVnd: 50_000_000 })

    expect(m).toHaveBeenCalledWith('/api/v1/monthly-plans/p1', expect.objectContaining({ method: 'PUT' }))
    expect(bodyOf(m)).toEqual({ salary_vnd: 50_000_000 })
    expect(r).toEqual({ ok: true })
  })

  it('surfaces the server error body on !ok', async () => {
    mockFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'boom' }) }))
    expect(await saveIncome({ planId: 'p1', month: 5, year: 2026, salaryVnd: 1 })).toEqual({ ok: false, error: 'boom' })
  })

  it('flags a network error when fetch throws', async () => {
    mockFetch(() => Promise.reject(new Error('offline')))
    expect(await saveIncome({ planId: 'p1', month: 5, year: 2026, salaryVnd: 1 })).toEqual({ ok: false, networkError: true })
  })
})

describe('planActions.deletePlan', () => {
  it('DELETEs the plan by id', async () => {
    const m = mockFetch(() => Promise.resolve({ ok: true }))
    const r = await deletePlan('p1')
    expect(m).toHaveBeenCalledWith('/api/v1/monthly-plans/p1', { method: 'DELETE' })
    expect(r).toEqual({ ok: true })
  })

  it('reports !ok without throwing when the server rejects', async () => {
    mockFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }))
    expect(await deletePlan('p1')).toEqual({ ok: false })
  })

  it('flags a network error when fetch throws', async () => {
    mockFetch(() => Promise.reject(new Error('x')))
    expect(await deletePlan('p1')).toEqual({ ok: false, networkError: true })
  })
})

describe('planActions.saveOtherExpense', () => {
  it('creates (POST) when no id', async () => {
    const m = mockFetch(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))

    const r = await saveOtherExpense({ planId: 'p1', description: 'Gift', amountVnd: 200_000 })

    expect(m).toHaveBeenCalledWith('/api/v1/monthly-plans/p1/other-expenses', expect.objectContaining({ method: 'POST' }))
    expect(bodyOf(m)).toEqual({ description: 'Gift', amount_vnd: 200_000 })
    expect(r).toEqual({ ok: true })
  })

  it('edits (PUT /:id) when an id is given', async () => {
    const m = mockFetch(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
    await saveOtherExpense({ planId: 'p1', id: 'oe1', description: 'Gift', amountVnd: 300_000 })
    expect(m).toHaveBeenCalledWith('/api/v1/monthly-plans/p1/other-expenses/oe1', expect.objectContaining({ method: 'PUT' }))
    expect(bodyOf(m)).toEqual({ description: 'Gift', amount_vnd: 300_000 })
  })

  it('surfaces the server error body on !ok', async () => {
    mockFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'nope' }) }))
    expect(await saveOtherExpense({ planId: 'p1', description: 'x', amountVnd: 1 })).toEqual({ ok: false, error: 'nope' })
  })

  it('flags a network error when fetch throws', async () => {
    mockFetch(() => Promise.reject(new Error('x')))
    expect(await saveOtherExpense({ planId: 'p1', description: 'x', amountVnd: 1 })).toEqual({ ok: false, networkError: true })
  })
})
