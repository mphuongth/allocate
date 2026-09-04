import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DModal } from '../desktopPlanningCards'

// #709 gave every overlay a backdrop that can tell a click from the end of a
// drag, but its sweep went through the sheets and missed the three desktop
// `DModal` copies — including this one, which is what the Plan page opens for
// "Tiết kiệm định kỳ" and "Quản lý chi phí cố định".
//
// So the bug the report came from survived exactly where it was reported:
// selecting the amount in a field by dragging out past the panel edge released
// on the backdrop, and a press and a release in different elements fire the
// click on their nearest common ancestor — the backdrop itself. The panel's
// stopPropagation is not on that path, so the modal closed and took the form
// with it.
describe('DModal — a selection drag is not a click-away (#709)', () => {
  it('does not close when a drag starts in the panel and ends on the backdrop', () => {
    const onClose = vi.fn()
    render(
      <DModal onClose={onClose} title="Tiết kiệm định kỳ">
        <input data-testid="field" defaultValue="1800000" />
      </DModal>,
    )
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement

    fireEvent.pointerDown(screen.getByTestId('field'))
    fireEvent.pointerUp(backdrop)
    fireEvent.click(backdrop)

    expect(onClose).not.toHaveBeenCalled()
  })

  // The suppression is one gesture wide. A modal that stopped answering its
  // backdrop after any drag would be the worse bug.
  it('still closes on the next genuine backdrop click', async () => {
    const onClose = vi.fn()
    render(
      <DModal onClose={onClose} title="Tiết kiệm định kỳ">
        <input data-testid="field" defaultValue="1800000" />
      </DModal>,
    )
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement

    fireEvent.pointerDown(screen.getByTestId('field'))
    fireEvent.pointerUp(backdrop)
    fireEvent.click(backdrop)
    expect(onClose).not.toHaveBeenCalled()

    await userEvent.click(backdrop)

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
