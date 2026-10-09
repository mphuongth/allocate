import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AllocationSummaryCard } from '../planningCards'
import { AllocationCard } from '../desktopPlanningCards'

// Over by less than half a percent rounded to "100% thu nhập" — sitting right
// next to "⚠ Vượt ngân sách", two claims that read as a contradiction. Once
// the plan is over, what you need is how much over, not a rounded share (#767).
//
// 10,000,000 income, 10,040,000 allocated: 100.4% → rounds to "100%".
const SALARY = 10_000_000
const ALLOCATED = 10_040_000

const cards = [
  ['mobile', (salary: number, fixed: number, isVI: boolean) => (
    <AllocationSummaryCard salary={salary} totalGoals={0} totalFixed={fixed} totalInsurance={0} totalOther={0} contributedTotal={0} isVI={isVI} />
  )],
  ['desktop', (salary: number, fixed: number, isVI: boolean) => (
    <AllocationCard salary={salary} totalGoalAmount={0} fixedTotal={fixed} insTotal={0} otherTotal={0} contributedTotal={0} isVI={isVI} />
  )],
] as const

describe.each(cards)('%s allocation card headline (#767)', (_view, card) => {
  it('says how much over, not a rounded 100%, once the plan is over budget', () => {
    render(card(SALARY, ALLOCATED, true))
    const headline = screen.getByTestId('planning-alloc-headline')
    expect(headline).toHaveTextContent('Vượt ngân sách 40K ₫')
    expect(headline).not.toHaveTextContent('100%')
    expect(headline).not.toHaveTextContent('thu nhập')
  })

  it('says it in English too', () => {
    render(card(SALARY, ALLOCATED, false))
    expect(screen.getByTestId('planning-alloc-headline')).toHaveTextContent('Over budget by 40K ₫')
  })

  it('still shows the share of income while within budget', () => {
    render(card(SALARY, 9_000_000, true))
    const headline = screen.getByTestId('planning-alloc-headline')
    expect(headline).toHaveTextContent('90% thu nhập')
    expect(headline).not.toHaveTextContent('Vượt')
  })
})
