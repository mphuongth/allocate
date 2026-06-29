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

describe('PlanningClient — toast delivery', () => {
  it('surfaces a confirmation toast (via sonner) after a successful income edit', async () => {
    const fetchMock = vi.fn((url: string) => {
      const u = String(url)
      // GET the full monthly plan (initial load + refetch after save).
      if (u.includes('/api/v1/monthly-plans?')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(FULL_PLAN) })
      }
      // PATCH the income update.
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
})
