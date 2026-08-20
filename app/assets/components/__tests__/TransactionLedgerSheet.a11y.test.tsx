import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TransactionLedgerSheet from '../TransactionLedgerSheet'

// Guard for #688. Every dialog in this file goes through one internal Shell —
// the ledger, the edit form, the CSV import and the delete confirmation — so the
// contract was missing from four overlays at once, and the delete confirmation
// opens on top of the ledger, which makes it the second nested case.
vi.mock('next-intl', () => ({
  useTranslations: () => (k: string, params?: Record<string, unknown>) =>
    params ? `${k}:${JSON.stringify(params)}` : k,
}))
vi.mock('../AddTransactionSheet', () => ({ default: () => null }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const tx = {
  transaction_id: 't1', asset_type: 'bank', transaction_type: 'investment',
  investment_date: '2026-06-01', amount_vnd: 10_000_000,
  savings_goals: { goal_name: 'House' },
}

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url.includes('savings-goals')) return Promise.resolve({ ok: true, json: async () => ({ goals: [] }) })
    if (url.includes('/api/funds')) return Promise.resolve({ ok: true, json: async () => ({ funds: [] }) })
    if (url.includes('investment-transactions')) return Promise.resolve({ ok: true, json: async () => ({ transactions: [tx], total: 1 }) })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  }) as never
})

for (const [name, desktop] of [['desktop', true], ['mobile', false]] as const) {
  describe(`TransactionLedgerSheet (${name}) — dialog contract (#688)`, () => {
    const props = { open: true, desktop, locale: 'en', onClose: vi.fn() }

    it('is a modal dialog named by its heading', async () => {
      render(<TransactionLedgerSheet {...props} />)

      const dialog = await screen.findByRole('dialog', { name: 'ledgerTitle' })
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(dialog).toBe(screen.getByTestId('tx-ledger'))
    })

    it('closes on Escape', async () => {
      const onClose = vi.fn()
      render(<TransactionLedgerSheet {...props} onClose={onClose} />)
      await screen.findByTestId('tx-ledger')

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('moves focus into the dialog and keeps Tab inside it', async () => {
      render(<TransactionLedgerSheet {...props} />)
      const dialog = await screen.findByTestId('tx-ledger')
      expect(dialog).toContainElement(document.activeElement as HTMLElement)

      const focusables = dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])')
      focusables[focusables.length - 1].focus()
      await userEvent.tab()

      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    })
  })
}

describe('TransactionLedgerSheet — the delete confirmation on top of the ledger (#688)', () => {
  const props = { open: true, desktop: true, locale: 'en', onClose: vi.fn() }

  async function openConfirm() {
    render(<TransactionLedgerSheet {...props} />)
    await screen.findByTestId('tx-ledger')
    const del = screen.getAllByTestId('tx-ledger-delete')[0]
    fireEvent.click(del)
    return screen.getByRole('dialog', { name: 'deleteTitle' })
  }

  it('is its own named modal dialog', async () => {
    const confirm = await openConfirm()

    expect(confirm).toHaveAttribute('aria-modal', 'true')
  })

  it('Escape closes only the confirmation, leaving the ledger open', async () => {
    await openConfirm()

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'deleteTitle' })).not.toBeInTheDocument())
    expect(screen.getByTestId('tx-ledger')).toBeInTheDocument()
  })

  it('traps Tab in the confirmation, not the ledger underneath', async () => {
    const confirm = await openConfirm()
    const focusables = confirm.querySelectorAll<HTMLElement>('button:not([disabled])')
    focusables[focusables.length - 1].focus()

    await userEvent.tab()

    expect(confirm).toContainElement(document.activeElement as HTMLElement)
  })
})
