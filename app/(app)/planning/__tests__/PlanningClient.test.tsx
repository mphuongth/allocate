import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PlanningClient from '../PlanningClient'

// PlanningClient owns the toast sink for the whole Plan page. Regression guard:
// it used to keep a local `useState` toast that was never rendered, so every
// confirmation ("Income updated", "Skipped X", …) was silently dropped. It must
// route through the globally-mounted sonner Toaster instead.
const { toastMock } = vi.hoisted(() => {
  const fn = vi.fn()
  return { toastMock: Object.assign(fn, { error: vi.fn(), success: vi.fn() }) }
})
vi.mock('sonner', () => ({ toast: toastMock }))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  useLocale: () => 'en',
}))

vi.mock('@/app/components/navigation/NavigationContext', () => ({
  useNavigation: () => ({ setMobileTopBar: vi.fn() }),
}))

const FULL_PLAN = {
  id: 'plan-1', month: 5, year: 2026, salary_vnd: 45_000_000,
  fixed_expense_overrides: [], fixed_expenses: [], excluded_insurance: [],
  insurance_overrides: [], insurance_members: [], fund_investments: [],
  direct_savings: [], other_expenses: [], goals: [], funds: [],
  recurring_savings: [], recurring_saving_overrides: [], dca_skips: [], recurring_fulfillments: [],
}

describe('PlanningClient — error vs empty on plan fetch', () => {
  it('shows an error state (not the empty "set income" state) when the fetch fails with 500', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: 'boom' }) }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      render(<PlanningClient />)
      // Error state appears in both the desktop + mobile views.
      expect((await screen.findAllByTestId('planning-error-state')).length).toBeGreaterThan(0)
      // It must NOT be mistaken for the legit "no plan yet" empty state.
      expect(screen.queryByTestId('planning-empty-state')).not.toBeInTheDocument()
      // A retry affordance is offered.
      expect(screen.getAllByRole('button', { name: /Try again/i }).length).toBeGreaterThan(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('shows the empty state on 404 (no plan yet), not the error state', async () => {
    const fetchMock = vi.fn((url: string) => {
      const u = String(url)
      if (u.includes('/api/v1/monthly-plans?')) {
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'Plan not found for this month' }) })
      }
      // The 404 branch still loads master fixed expenses + insurance members.
      if (u.includes('fixed-expenses')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ expenses: [] }) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ members: [] }) })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      render(<PlanningClient />)
      expect((await screen.findAllByTestId('planning-empty-state')).length).toBeGreaterThan(0)
      expect(screen.queryByTestId('planning-error-state')).not.toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not get stuck on the skeleton when the fetch rejects (network error) → shows error', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('offline')))
    vi.stubGlobal('fetch', fetchMock)
    try {
      render(<PlanningClient />)
      expect((await screen.findAllByTestId('planning-error-state')).length).toBeGreaterThan(0)
      expect(screen.queryByTestId('planning-loading')).not.toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('retry refetches and renders the plan once the request succeeds', async () => {
    let call = 0
    const fetchMock = vi.fn((url: string) => {
      const u = String(url)
      if (u.includes('/api/v1/monthly-plans?')) {
        call += 1
        if (call === 1) return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: 'boom' }) })
        return Promise.resolve({ ok: true, json: () => Promise.resolve(FULL_PLAN) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      render(<PlanningClient />)
      const retry = (await screen.findAllByRole('button', { name: /Try again/i }))[0]
      await userEvent.click(retry)
      await waitFor(() => expect(screen.queryByTestId('planning-error-state')).not.toBeInTheDocument())
      // The plan content (income editor) is now shown.
      expect((await screen.findAllByRole('button', { name: 'Edit income' })).length).toBeGreaterThan(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('PlanningClient — toast delivery', () => {
  it('surfaces a confirmation toast (via sonner) after a successful income edit', async () => {
    const fetchMock = vi.fn((url: string) => {
      const u = String(url)
      // GET the full monthly plan (initial load + refetch after save).
      if (u.includes('/api/v1/monthly-plans?')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(FULL_PLAN) })
      }
      // PUT the income update.
      return Promise.resolve({ ok: true, json: () => Promise.resolve(FULL_PLAN) })
    })
    vi.stubGlobal('fetch', fetchMock)
    toastMock.mockClear()
    try {
      render(<PlanningClient />)
      const desktop = screen.getByTestId('desktop-planning')
      const editBtn = await within(desktop).findByRole('button', { name: 'Edit income' })
      await userEvent.click(editBtn)
      const input = await within(desktop).findByPlaceholderText('e.g. 45,000,000')
      await userEvent.clear(input)
      await userEvent.type(input, '50000000')
      await userEvent.click(within(desktop).getByRole('button', { name: 'Save' }))
      // The dead-sink bug meant toast was never called; now it reaches sonner.
      await waitFor(() => expect(toastMock).toHaveBeenCalled())
    } finally {
      vi.unstubAllGlobals()
    }
  })

  // Regression: desktop edited income via PATCH, but /api/v1/monthly-plans/[id]
  // only handles PUT (no PATCH export → Next.js returns 405). The save then
  // failed silently with the error toast. Mobile already used PUT — this pins
  // desktop to the same method so both views hit a real handler.
  it('updates an existing plan with PUT (not PATCH → 405) from the desktop income editor', async () => {
    const fetchMock = vi.fn((url: string) => {
      const u = String(url)
      if (u.includes('/api/v1/monthly-plans?')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(FULL_PLAN) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(FULL_PLAN) })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      render(<PlanningClient />)
      const desktop = screen.getByTestId('desktop-planning')
      const editBtn = await within(desktop).findByRole('button', { name: 'Edit income' })
      await userEvent.click(editBtn)
      const input = await within(desktop).findByPlaceholderText('e.g. 45,000,000')
      await userEvent.clear(input)
      await userEvent.type(input, '50000000')
      await userEvent.click(within(desktop).getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        const updateCall = fetchMock.mock.calls.find(
          ([u, opts]) => String(u) === `/api/v1/monthly-plans/${FULL_PLAN.id}` && opts,
        )
        expect(updateCall).toBeTruthy()
        expect((updateCall![1] as RequestInit).method).toBe('PUT')
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
