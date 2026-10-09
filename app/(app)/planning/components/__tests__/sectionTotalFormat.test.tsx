import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Wallet } from 'lucide-react'
import { BudgetSection } from '../planningCards'
import { PlanTable } from '../desktopPlanningCards'

// One rule for totals on the Plan page: an aggregate is compact ("45.0M ₫"),
// a single line item is exact ("₫ 45.000.000"). The allocation card already
// summed compact while each section header summed exact, so the same kind of
// figure read two ways on one screen (#768). Real formatters, not a mock: the
// format is the thing under test.
describe('section header totals are compact (#768)', () => {
  it('mobile BudgetSection', () => {
    render(<BudgetSection icon={Wallet} iconColor="red" title="Chi phí cố định" total={45_200_000}>row</BudgetSection>)
    const total = screen.getByTestId('budget-section-total')
    expect(total).toHaveTextContent('45.2M ₫')
    expect(total).not.toHaveTextContent('45.200.000')
  })

  it('desktop PlanTable', () => {
    render(<PlanTable icon={<Wallet />} iconColor="red" title="Chi phí cố định" total={45_200_000}>row</PlanTable>)
    const total = screen.getByTestId('budget-section-total')
    expect(total).toHaveTextContent('45.2M ₫')
    expect(total).not.toHaveTextContent('45.200.000')
  })
})
