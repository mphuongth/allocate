import { describe, it, expect, vi } from 'vitest'
import { useState, type ReactNode } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// The dialog contract of #688, as one reusable suite.
//
// Every overlay owes a keyboard user the same six things, and writing them out
// per sheet is what let them drift apart in the first place — some had Escape,
// some had a trap, almost none had a name. Stating the contract once means a new
// sheet inherits the assertions by naming itself, and a sheet cannot quietly
// meet four of six.

export function dialogContract({
  name,
  open,
  accessibleName,
  /** A control inside the panel, for the click-inside case. */
  insideTestId,
  /** False for sheets whose inputs are not user-typed (nothing to zoom). */
  checksInputZoom = true,
}: {
  name: string
  open: (onClose: () => void) => ReactNode
  accessibleName: string | RegExp
  insideTestId?: string
  checksInputZoom?: boolean
}) {
  describe(`${name} — dialog contract (#688)`, () => {
    it('is a modal dialog with an accessible name', () => {
      render(<>{open(() => {})}</>)

      const dialog = screen.getByRole('dialog', { name: accessibleName })
      expect(dialog).toHaveAttribute('aria-modal', 'true')
    })

    it('closes on Escape', () => {
      const onClose = vi.fn()
      render(<>{open(onClose)}</>)

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('moves focus into the dialog on open', () => {
      render(<>{open(() => {})}</>)

      // Not left on the page behind it, where Tab would walk the content
      // underneath the overlay.
      expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
    })

    it('keeps Tab inside the dialog', async () => {
      render(<>{open(() => {})}</>)
      const dialog = screen.getByRole('dialog')
      const focusables = dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
      focusables[focusables.length - 1]?.focus()

      await userEvent.tab()

      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    })

    it('keeps Shift+Tab inside the dialog', async () => {
      render(<>{open(() => {})}</>)
      const dialog = screen.getByRole('dialog')
      const focusables = dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
      focusables[0]?.focus()

      await userEvent.tab({ shift: true })

      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    })

    it('restores focus to the control that opened it', async () => {
      function Harness() {
        const [shown, setShown] = useState(false)
        return (
          <>
            <button type="button" onClick={() => setShown(true)}>launch</button>
            {shown && open(() => setShown(false))}
          </>
        )
      }
      render(<Harness />)
      const trigger = screen.getByText('launch')
      await userEvent.click(trigger)
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      fireEvent.keyDown(document, { key: 'Escape' })

      await waitFor(() => expect(trigger).toHaveFocus())
    })

    it('closes on a click outside the panel', async () => {
      const onClose = vi.fn()
      render(<>{open(onClose)}</>)

      await userEvent.click(screen.getAllByTestId('dialog-overlay')[0])

      expect(onClose).toHaveBeenCalled()
    })

    if (insideTestId) {
      it('does not close on a click inside the panel', async () => {
        const onClose = vi.fn()
        render(<>{open(onClose)}</>)

        await userEvent.click(screen.getByTestId(insideTestId))

        expect(onClose).not.toHaveBeenCalled()
      })
    }

    if (checksInputZoom) {
      it('sets typed inputs at 16px so iOS Safari does not zoom on focus (#265)', () => {
        render(<>{open(() => {})}</>)

        const inputs = screen.getByRole('dialog').querySelectorAll<HTMLInputElement>('input')
        expect(inputs.length, 'no inputs to check — pass checksInputZoom: false').toBeGreaterThan(0)
        for (const input of inputs) {
          if (!input.style.fontSize) continue
          expect(Number.parseFloat(input.style.fontSize)).toBeGreaterThanOrEqual(16)
        }
      })
    }
  })
}
