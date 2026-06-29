import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import AssignGoalSheet from '../AssignGoalSheet'

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (k: string) => k,
}))

const baseProps = {
  open: true,
  desktop: true,
  onClose: vi.fn(),
  onConfirm: vi.fn(),
  item: { name: 'Techcombank', value: 50_000_000, type: 'bank' },
}

describe('AssignGoalSheet — goals load error vs empty', () => {
  it('shows a retry state (not "No goals yet") when the goals fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) })

    render(<AssignGoalSheet {...baseProps} />)

    await waitFor(() => expect(screen.getByTestId('load-error')).toBeInTheDocument())
    expect(screen.queryByText('No goals yet')).not.toBeInTheDocument()
  })

  it('retry re-fetches and renders the goals on success', async () => {
    let call = 0
    global.fetch = vi.fn().mockImplementation(() => {
      call += 1
      if (call === 1) return Promise.resolve({ ok: false, json: async () => ({}) })
      return Promise.resolve({
        ok: true,
        json: async () => ({ goals: [{ goal_id: 'g1', goal_name: 'House Fund', current_value: 1_000_000 }] }),
      })
    })

    render(<AssignGoalSheet {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('load-error')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('load-error-retry'))

    await waitFor(() => expect(screen.getByText('House Fund')).toBeInTheDocument())
    expect(screen.queryByTestId('load-error')).not.toBeInTheDocument()
  })

  it('gives the close button a ≥44px touch target', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ goals: [] }) })

    render(<AssignGoalSheet {...baseProps} />)

    const close = await screen.findByRole('button', { name: 'Close' })
    expect(parseFloat(close.style.minWidth)).toBeGreaterThanOrEqual(44)
    expect(parseFloat(close.style.minHeight)).toBeGreaterThanOrEqual(44)
  })
})
