import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { clickAway } from '../clickAway'

// Every backdrop in the app dismisses on click and every panel stops its own
// clicks — a pairing with a hole in it. A press and a release in different
// elements fire the click on their nearest common ancestor, so dragging to
// select a field's text from inside the panel out past its edge fires the click
// on the BACKDROP. The panel is not on that event's path, its stopPropagation
// never runs, and the sheet closed with the user's input in it.

function Overlay({ onDismiss }: { onDismiss?: () => void }) {
  return (
    <div data-testid="overlay" {...clickAway(onDismiss)}>
      <div data-testid="panel" onClick={(e) => e.stopPropagation()}>
        <input data-testid="field" defaultValue="55000000" />
      </div>
    </div>
  )
}

describe('clickAway', () => {
  it('dismisses on a press and release that both land on the backdrop', async () => {
    const onDismiss = vi.fn()
    render(<Overlay onDismiss={onDismiss} />)

    await userEvent.click(screen.getByTestId('overlay'))

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('does not dismiss when the gesture starts inside the panel', () => {
    const onDismiss = vi.fn()
    render(<Overlay onDismiss={onDismiss} />)
    const overlay = screen.getByTestId('overlay')

    // The shape a text-selection drag leaves: pressed in the field, released
    // past the panel, click retargeted to their common ancestor.
    fireEvent.pointerDown(screen.getByTestId('field'))
    fireEvent.pointerUp(overlay)
    fireEvent.click(overlay)

    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('suppresses exactly one gesture, not every click after a drag', async () => {
    const onDismiss = vi.fn()
    render(<Overlay onDismiss={onDismiss} />)
    const overlay = screen.getByTestId('overlay')

    fireEvent.pointerDown(screen.getByTestId('field'))
    fireEvent.pointerUp(overlay)
    fireEvent.click(overlay)
    await userEvent.click(overlay)

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  // The flag is module-level — one pointer gesture exists at a time, and every
  // overlay is asking about the same one. What must not happen is a completed
  // interaction inside one panel leaving the next backdrop click deaf.
  it('a click completed inside the panel does not deafen the next backdrop click', async () => {
    const onDismiss = vi.fn()
    render(<Overlay onDismiss={onDismiss} />)

    await userEvent.click(screen.getByTestId('field'))
    expect(onDismiss).not.toHaveBeenCalled()

    await userEvent.click(screen.getByTestId('overlay'))

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  // An overlay that deliberately does not dismiss (a save in flight) passes
  // undefined. It must stay inert rather than throw on the backdrop click.
  it('is inert when the overlay has no dismiss handler', async () => {
    render(<Overlay />)

    await userEvent.click(screen.getByTestId('overlay'))

    expect(screen.getByTestId('panel')).toBeInTheDocument()
  })
})
