import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Wallet } from 'lucide-react'
import { BudgetSection } from '../planningCards'

describe('BudgetSection', () => {
  // The chevron is a bare 16px icon with no padding; its tap area must still be
  // 44px, without pushing the header taller (#766).
  it('gives the collapse chevron a 44px hit area', () => {
    render(<BudgetSection icon={Wallet} iconColor="red" title="Chi phí" total={1000}>body</BudgetSection>)
    expect(screen.getByRole('button', { name: 'Toggle section' })).toHaveClass('hit-44')
  })

  it('still collapses from the chevron', async () => {
    render(<BudgetSection icon={Wallet} iconColor="red" title="Chi phí" total={1000}>body</BudgetSection>)
    expect(screen.getByText('body')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Toggle section' }))
    expect(screen.queryByText('body')).toBeNull()
  })
})
