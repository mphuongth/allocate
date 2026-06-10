import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SalaryInput from '../SalaryInput'
import type { MonthlyPlan } from '../../PlanningClient'

vi.mock('next-intl', () => ({
  useTranslations: () => {
    const t = (key: string) => key
    ;(t as unknown as { rich: (k: string) => string }).rich = (key: string) => key
    return t
  },
}))

const plan: MonthlyPlan = { id: 'p1', month: 6, year: 2026, salary_vnd: 45_000_000 }

afterEach(() => vi.unstubAllGlobals())

describe('SalaryInput loading state (§03 button/inline mutation)', () => {
  it('shows the brand Cairn loader while saving, not a CSS border-spinner', async () => {
    // fetch never resolves → component stays in the saving state
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { container } = render(
      <SalaryInput plan={plan} month={6} year={2026} onPlanCreated={() => {}} onPlanDeleted={() => {}} />,
    )

    // Blur the salary field → triggers saveSalary() with the preset value.
    fireEvent.blur(screen.getByTestId('salary-input'))

    await waitFor(() => {
      expect(container.querySelector('.cairn-loader')).toBeInTheDocument()
    })
    // The old ad-hoc CSS spinner must be gone.
    expect(container.querySelector('.animate-spin')).toBeNull()
  })
})
