import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Edit and delete live behind a fund card's "⋯" menu (#769), so reaching
// either is two taps: open the menu, choose the item.
export async function chooseFundAction(action: 'editFund' | 'deleteBtn', fundId = 'f1') {
  const card = within(screen.getByTestId(`fund-card-${fundId}`))
  await userEvent.click(card.getByRole('button', { name: 'fundActions' }))
  await userEvent.click(screen.getByRole('menuitem', { name: action }))
}
