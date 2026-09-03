import { describe, it, expect, vi } from 'vitest'
import { useRef, useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DialogShell from '../DialogShell'

// Guard for #688. The app has a shared dialog contract (useDialogA11y), but the
// asset and planning overlays each hand-rolled their own fixed <div> and skipped
// it — no role, no accessible name, focus left behind the overlay, Tab escaping,
// Escape doing nothing. Wiring each of them individually is how the contract got
// lost in the first place, so the contract now lives in a wrapper: what a sheet
// supplies is its own content and styling, and it cannot opt out of the
// behaviour by forgetting a hook.

function Harness({ onClose = () => {}, dismissOnClickAway = true }: { onClose?: () => void; dismissOnClickAway?: boolean }) {
  return (
    <DialogShell onClose={onClose} label="Test dialog" dismissOnClickAway={dismissOnClickAway} panelProps={{ 'data-testid': 'panel' }}>
      <button type="button">first</button>
      <button type="button">second</button>
    </DialogShell>
  )
}

describe('DialogShell — dialog semantics (#688)', () => {
  it('is a role=dialog, modal, with an accessible name', () => {
    render(<Harness />)

    const dialog = screen.getByRole('dialog', { name: 'Test dialog' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toBe(screen.getByTestId('panel'))
  })

  it('takes its name from a heading when given one', () => {
    render(
      <DialogShell onClose={() => {}} labelledBy="t">
        <h2 id="t">Open successor book</h2>
      </DialogShell>,
    )

    expect(screen.getByRole('dialog', { name: 'Open successor book' })).toBeInTheDocument()
  })
})

describe('DialogShell — keyboard contract (#688)', () => {
  it('moves focus into the dialog on open', () => {
    render(<Harness />)

    // Focus lands on the first focusable, not left behind on the trigger where a
    // keyboard user would be tabbing through the page underneath.
    expect(screen.getByText('first')).toHaveFocus()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('wraps Tab from the last control back to the first', async () => {
    render(<Harness />)

    screen.getByText('second').focus()
    await userEvent.tab()

    expect(screen.getByText('first')).toHaveFocus()
  })

  it('wraps Shift+Tab from the first control to the last', async () => {
    render(<Harness />)

    screen.getByText('first').focus()
    await userEvent.tab({ shift: true })

    expect(screen.getByText('second')).toHaveFocus()
  })

  it('restores focus to the control that opened it', async () => {
    function Openable() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>open</button>
          {open && (
            <DialogShell onClose={() => setOpen(false)} label="d">
              <button type="button">inside</button>
            </DialogShell>
          )}
        </>
      )
    }
    render(<Openable />)
    const trigger = screen.getByText('open')
    await userEvent.click(trigger)
    expect(screen.getByText('inside')).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(trigger).toHaveFocus())
  })
})

describe('DialogShell — dismissal (#688)', () => {
  it('closes on a click outside the panel', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)

    await userEvent.click(screen.getByTestId('dialog-overlay'))

    expect(onClose).toHaveBeenCalled()
  })

  it('does not close on a click inside the panel', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)

    await userEvent.click(screen.getByText('first'))

    expect(onClose).not.toHaveBeenCalled()
  })

  // Selecting the text in a field by dragging — press inside the input, sweep
  // past the panel edge, release — closed the dialog and threw the form away.
  // The panel's onClick stopPropagation cannot catch it: a press and a release in
  // different elements fire the click on their nearest COMMON ancestor, which is
  // the overlay, so the panel is not on the event path at all. Nothing about the
  // gesture is a click-away, and the user loses what they typed.
  it('does not close when a selection drag starts in the panel and ends on the overlay', () => {
    const onClose = vi.fn()
    render(
      <DialogShell onClose={onClose} label="d" panelProps={{ 'data-testid': 'panel' }}>
        <input data-testid="field" defaultValue="55000000" />
      </DialogShell>,
    )
    const overlay = screen.getByTestId('dialog-overlay')

    fireEvent.pointerDown(screen.getByTestId('field'))
    fireEvent.pointerUp(overlay)
    fireEvent.click(overlay)

    expect(onClose).not.toHaveBeenCalled()
  })

  // The suppression above lasts exactly one gesture. A dialog that stopped
  // answering the backdrop after any drag would be a worse bug than the one fixed.
  it('still closes on the next genuine backdrop click after such a drag', async () => {
    const onClose = vi.fn()
    render(
      <DialogShell onClose={onClose} label="d" panelProps={{ 'data-testid': 'panel' }}>
        <input data-testid="field" defaultValue="55000000" />
      </DialogShell>,
    )
    const overlay = screen.getByTestId('dialog-overlay')

    fireEvent.pointerDown(screen.getByTestId('field'))
    fireEvent.pointerUp(overlay)
    fireEvent.click(overlay)
    expect(onClose).not.toHaveBeenCalled()

    await userEvent.click(overlay)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('holds the overlay shut while a save is in flight', async () => {
    // Clicking away mid-save used to discard a form that was already writing.
    const onClose = vi.fn()
    render(<Harness onClose={onClose} dismissOnClickAway={false} />)

    await userEvent.click(screen.getByTestId('dialog-overlay'))

    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('DialogShell — nesting (#688)', () => {
  it('lets only the topmost dialog answer Escape', () => {
    // The successor flow opens a dialog from inside a dialog. Both listen on
    // document, so without a stack one Escape collapsed the whole pile and the
    // user lost the sheet they were actually in.
    const outer = vi.fn()
    const inner = vi.fn()
    render(
      <>
        <DialogShell onClose={outer} label="outer"><button type="button">o</button></DialogShell>
        <DialogShell onClose={inner} label="inner"><button type="button">i</button></DialogShell>
      </>,
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })

  it('hands Escape back to the parent once the child closes', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    function Nested() {
      const [childOpen, setChildOpen] = useState(true)
      return (
        <>
          <DialogShell onClose={outer} label="outer"><button type="button">o</button></DialogShell>
          {childOpen && (
            <DialogShell onClose={() => { inner(); setChildOpen(false) }} label="inner">
              <button type="button">i</button>
            </DialogShell>
          )}
        </>
      )
    }
    render(<Nested />)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(outer).toHaveBeenCalledTimes(1)
  })

  it('traps Tab inside the topmost dialog, not the one underneath', async () => {
    render(
      <>
        <DialogShell onClose={() => {}} label="outer"><button type="button">outer-btn</button></DialogShell>
        <DialogShell onClose={() => {}} label="inner">
          <button type="button">inner-a</button>
          <button type="button">inner-b</button>
        </DialogShell>
      </>,
    )

    screen.getByText('inner-b').focus()
    await userEvent.tab()

    expect(screen.getByText('inner-a')).toHaveFocus()
  })
})

// A ref is how the useDialogA11y hook was used directly; the wrapper must not
// take that away from a sheet that needs to measure or scroll its own panel.
describe('DialogShell — panel ref (#688)', () => {
  it('forwards a ref to the panel', () => {
    function WithRef() {
      const ref = useRef<HTMLDivElement>(null)
      return (
        <DialogShell onClose={() => {}} label="d" panelRef={ref}>
          <button type="button" onClick={() => ref.current?.setAttribute('data-measured', '1')}>measure</button>
        </DialogShell>
      )
    }
    render(<WithRef />)

    fireEvent.click(screen.getByText('measure'))

    expect(screen.getByRole('dialog')).toHaveAttribute('data-measured', '1')
  })
})
