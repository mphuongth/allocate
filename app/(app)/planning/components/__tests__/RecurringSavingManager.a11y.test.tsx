import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RecurringSavingManager from '../RecurringSavingManager'

// Guard for #688. The other half of Planning's delete confirmations. Like the
// fixed-expense one it had no dialog semantics, no Escape and no focus handling
// — and this is the overlay whose confirm button destroys a saving rule.
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  useLocale: () => 'en',
}))
vi.mock('@/lib/formatters', () => ({ fmt: (n: number) => `₫ ${n}`, fmtCompact: (n: number) => `₫ ${n}` }))

const savings = [
  {
    saving_id: 'rs1', name: 'Monthly transfer', goal_id: null, amount_vnd: 5_000_000,
    effective_from: null, effective_to: null, linked_deposit_tx_id: null,
    savings_goals: null,
  },
]

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes('recurring-savings')) return { ok: true, json: async () => ({ savings }) }
    return { ok: true, json: async () => ({}) }
  })
  vi.stubGlobal('fetch', fetchMock)
})

for (const variant of ['modal', 'sheet'] as const) {
  describe(`RecurringSavingManager (${variant}) — delete confirmation contract (#688)`, () => {
    async function openConfirm() {
      render(<RecurringSavingManager goals={[]} onChange={vi.fn()} variant={variant} />)
      const del = await screen.findByTestId('rs-delete')
      await userEvent.click(del)
      return screen.getByTestId('rs-delete-overlay')
    }

    it('is a modal dialog with an accessible name', async () => {
      await openConfirm()

      const dialog = screen.getByRole('dialog', { name: 'Delete recurring saving?' })
      expect(dialog).toHaveAttribute('aria-modal', 'true')
    })

    it('closes on Escape without deleting anything', async () => {
      await openConfirm()

      fireEvent.keyDown(document, { key: 'Escape' })

      await waitFor(() => expect(screen.queryByTestId('rs-delete-overlay')).not.toBeInTheDocument())
      expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toBe(false)
    })

    it('moves focus into the confirmation and keeps Tab inside it', async () => {
      await openConfirm()
      const dialog = screen.getByRole('dialog')
      expect(dialog).toContainElement(document.activeElement as HTMLElement)

      const buttons = dialog.querySelectorAll<HTMLElement>('button:not([disabled])')
      buttons[buttons.length - 1].focus()
      await userEvent.tab()

      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    })

    it('restores focus to the delete button that opened it', async () => {
      await openConfirm()
      const trigger = screen.getByTestId('rs-delete')

      fireEvent.keyDown(document, { key: 'Escape' })

      await waitFor(() => expect(trigger).toHaveFocus())
    })
  })
}
