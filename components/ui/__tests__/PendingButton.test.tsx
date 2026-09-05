import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PendingButton from '../PendingButton'

// The loading vocabulary as a component, not as a checklist (#235, #688).
//
// The cairn loader has existed since #235, but only five of the app's 27 dialog
// files ever put it on a confirm button. The other 22 answered a click with an
// opacity change — and eight of those not even that: the icon and the label sat
// perfectly still while the request was in flight, so the only honest reading of
// the button was "nothing happened, press it again".
//
// So the pending state belongs to the button now. A caller supplies the resting
// icon and label; it cannot forget the loader, the busy semantics, or the guard
// against a second submit.

describe('PendingButton — the pending contract', () => {
  it('shows the resting icon and label when idle', () => {
    render(
      <PendingButton pending={false} icon={<svg data-testid="rest-icon" />} pendingLabel="Saving...">
        Save
      </PendingButton>,
    )

    expect(screen.getByTestId('rest-icon')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.queryByText('Saving...')).not.toBeInTheDocument()
  })

  it('swaps the icon for the animated cairn loader while pending', () => {
    const { container } = render(
      <PendingButton pending icon={<svg data-testid="rest-icon" />} pendingLabel="Saving...">
        Save
      </PendingButton>,
    )

    expect(screen.queryByTestId('rest-icon')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.cairn-loader .stone')).toHaveLength(3)
  })

  it('swaps the label for the pending label while pending', () => {
    render(
      <PendingButton pending pendingLabel="Saving...">
        Save
      </PendingButton>,
    )

    expect(screen.getByRole('button', { name: 'Saving...' })).toBeInTheDocument()
  })

  it('keeps the resting label when the caller gives no pending label', () => {
    render(<PendingButton pending>Top up</PendingButton>)

    expect(screen.getByRole('button', { name: 'Top up' })).toBeInTheDocument()
  })

  it('marks the button busy for assistive tech while pending', () => {
    render(<PendingButton pending pendingLabel="Saving...">Save</PendingButton>)

    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true')
  })

  it('is not busy when idle', () => {
    render(<PendingButton pending={false}>Save</PendingButton>)

    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'false')
  })

  it('hides the loader from the accessible name, which stays the label alone', () => {
    render(<PendingButton pending pendingLabel="Saving...">Save</PendingButton>)

    // The loader carries role=status/aria-label="Loading"; unhidden it would
    // land inside the button's name as "Loading Saving...".
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('blocks a second submit while the first is in flight', async () => {
    const onClick = vi.fn()
    render(<PendingButton pending onClick={onClick}>Save</PendingButton>)

    const btn = screen.getByRole('button')
    expect(btn).toBeDisabled()
    await userEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('still honours a caller-supplied disabled', async () => {
    const onClick = vi.fn()
    render(<PendingButton pending={false} disabled onClick={onClick}>Save</PendingButton>)

    expect(screen.getByRole('button')).toBeDisabled()
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('fires its click when idle and enabled', async () => {
    const onClick = vi.fn()
    render(<PendingButton pending={false} onClick={onClick}>Save</PendingButton>)

    await userEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('defaults to type=button so it cannot submit a surrounding form by accident', () => {
    render(<PendingButton pending={false}>Save</PendingButton>)

    expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
  })

  it('lets a real form button opt into type=submit', () => {
    render(<PendingButton pending={false} type="submit">Save</PendingButton>)

    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit')
  })

  it('keeps the loader legible on a light button via the variant', () => {
    const { container } = render(
      <PendingButton pending loaderVariant="muted">Save</PendingButton>,
    )

    expect(container.querySelector('.cairn-loader')?.className).toContain('muted')
  })

  it('defaults the loader to the on-dark variant, for a filled primary button', () => {
    const { container } = render(<PendingButton pending>Save</PendingButton>)

    expect(container.querySelector('.cairn-loader')?.className).toContain('on-dark')
  })

  it('passes className, style and arbitrary props through to the button', () => {
    render(
      <PendingButton pending={false} className="cn-btn primary" style={{ flex: 2 }} data-testid="submit">
        Save
      </PendingButton>,
    )

    const btn = screen.getByTestId('submit')
    expect(btn.className).toContain('cn-btn')
    expect(btn).toHaveStyle({ flex: 2 })
  })
})
