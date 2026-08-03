import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NavigationProvider, useNavigation } from '../NavigationContext'

// The add-transaction sheet is opened by the mobile bottom tabs' centre "+" but
// rendered by the route group, not by the layout (#600). The layout is shared
// chrome under `components/`, so it must not import a screen's component — the
// open state is what crosses between them, and it lives here.
function Trigger() {
  const { openAddTransaction } = useNavigation()
  return <button onClick={openAddTransaction}>open</button>
}

function Sheet() {
  const { addTransactionOpen, closeAddTransaction } = useNavigation()
  if (!addTransactionOpen) return null
  return <button onClick={closeAddTransaction}>sheet</button>
}

describe('NavigationContext add-transaction state', () => {
  it('lets a trigger and a sheet in different subtrees share one open flag', async () => {
    const user = userEvent.setup()
    render(
      <NavigationProvider userName="Test">
        <Trigger />
        <Sheet />
      </NavigationProvider>,
    )

    expect(screen.queryByText('sheet')).toBeNull()
    await user.click(screen.getByText('open'))
    expect(screen.getByText('sheet')).toBeInTheDocument()
    await user.click(screen.getByText('sheet'))
    expect(screen.queryByText('sheet')).toBeNull()
  })

  it('defaults to closed outside a provider', () => {
    render(<Sheet />)
    expect(screen.queryByText('sheet')).toBeNull()
  })
})
