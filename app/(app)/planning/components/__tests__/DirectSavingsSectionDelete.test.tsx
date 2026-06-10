import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import DirectSavingsSection from '../DirectSavingsSection'
import type { MonthlyPlan, DirectSaving, Goal } from '../../PlanningClient'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
vi.mock('@/lib/formatters', () => ({ fmt: (n: number) => `₫${n}` }))

const plan: MonthlyPlan = { id: 'p1', month: 6, year: 2026, salary_vnd: 45_000_000 }
const saving: DirectSaving = {
  transaction_id: 't1', plan_id: 'p1', goal_id: null, amount_vnd: 5_000_000,
  interest_rate: null, expiry_date: null, investment_date: '2026-06-01', savings_goals: null,
}
const goals: Goal[] = []

afterEach(() => vi.unstubAllGlobals())

// §04: destructive mutations (delete) get the same in-button Cairn + disabled +
// tense as other mutations, and must not be double-submittable.
describe('DirectSavingsSection delete loading state', () => {
  it('shows the Cairn loader and disables the confirm button while deleting', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))) // never resolves → stays deleting
    render(
      <DirectSavingsSection plan={plan} savings={[saving]} goals={goals} onRefresh={() => {}} onToast={() => {}} />,
    )

    // Open the delete confirmation, then confirm. (Dialog renders in a portal,
    // so query at document level, not within the render container.)
    fireEvent.click(screen.getByLabelText('delete'))
    const confirm = screen.getByTestId('savings-delete-confirm')
    expect(confirm).not.toBeDisabled()
    fireEvent.click(confirm)

    await waitFor(() => {
      expect(document.querySelector('.cairn-loader')).toBeInTheDocument()
    })
    expect(screen.getByTestId('savings-delete-confirm')).toBeDisabled()
  })
})
