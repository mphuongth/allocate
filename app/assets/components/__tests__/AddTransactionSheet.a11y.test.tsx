import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import AddTransactionSheet from '../AddTransactionSheet'

// Guard for #688. Both wrappers — the desktop centred modal and the mobile
// bottom sheet — were bare fixed <div>s. The form inside is the app's longest,
// so Tab escaping it dropped a keyboard user into the page behind a scrim they
// could not see past.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}))

beforeEach(() => {
  document.body.style.overflow = ''
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve([]) })))
})

for (const [name, desktop] of [['desktop', true], ['mobile', false]] as const) {
  describe(`AddTransactionSheet (${name}) — dialog contract (#688)`, () => {
    it('is a modal dialog named by its own heading', () => {
      render(<AddTransactionSheet open onClose={vi.fn()} desktop={desktop} />)

      const dialog = screen.getByRole('dialog', { name: 'title' })
      expect(dialog).toHaveAttribute('aria-modal', 'true')
    })

    it('takes the edit title when editing an existing transaction', () => {
      render(<AddTransactionSheet open onClose={vi.fn()} desktop={desktop} existing={{ id: 't1' } as never} />)

      expect(screen.getByRole('dialog', { name: 'editTitle' })).toBeInTheDocument()
    })

    it('closes on Escape', () => {
      const onClose = vi.fn()
      render(<AddTransactionSheet open onClose={onClose} desktop={desktop} />)

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('moves focus into the dialog on open', () => {
      render(<AddTransactionSheet open onClose={vi.fn()} desktop={desktop} />)

      expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
    })

    it('keeps Tab inside the dialog', async () => {
      render(<AddTransactionSheet open onClose={vi.fn()} desktop={desktop} />)
      const dialog = screen.getByRole('dialog')
      const focusables = dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')
      focusables[focusables.length - 1].focus()

      await userEvent.tab()

      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    })

    it('restores focus to the control that opened it', async () => {
      function Harness() {
        const [open, setOpen] = useState(false)
        return (
          <>
            <button type="button" onClick={() => setOpen(true)}>add</button>
            {open && <AddTransactionSheet open onClose={() => setOpen(false)} desktop={desktop} />}
          </>
        )
      }
      render(<Harness />)
      const trigger = screen.getByText('add')
      await userEvent.click(trigger)

      fireEvent.keyDown(document, { key: 'Escape' })

      await waitFor(() => expect(trigger).toHaveFocus())
    })

    it('still closes on a click outside the panel', async () => {
      const onClose = vi.fn()
      render(<AddTransactionSheet open onClose={onClose} desktop={desktop} />)

      await userEvent.click(screen.getByTestId('dialog-overlay'))

      expect(onClose).toHaveBeenCalled()
    })
  })
}
