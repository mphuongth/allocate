import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { OverviewEmptyState } from '../OverviewEmptyState'
import viMessages from '../../../../messages/vi.json'

// OverviewEmptyState.test.tsx mocks next-intl to an identity function, so it
// can't see the real copy. This suite renders against the actual Vietnamese
// messages to pin the reworded onboarding footer: the old caption ended on a
// dangling preposition ("Hoặc quản lý mọi thứ trong") that ran straight into a
// separate "Cài đặt" button, reading as a broken sentence. The caption is now a
// standalone "Hoặc" and the button carries the full action label.

function renderVi() {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages} timeZone="Asia/Ho_Chi_Minh">
      <OverviewEmptyState onAddGoal={() => {}} onAddInsurance={() => {}} />
    </NextIntlClientProvider>,
  )
}

describe('OverviewEmptyState — Vietnamese footer copy', () => {
  it('reads as a self-contained divider + labelled action, not a broken sentence', () => {
    renderVi()
    // The dangling caption must be gone.
    expect(screen.queryByText('Hoặc quản lý mọi thứ trong')).not.toBeInTheDocument()
    // Standalone divider caption.
    expect(screen.getByText('Hoặc')).toBeInTheDocument()
    // The settings action now carries the full label.
    const link = screen.getByText('Quản lý trong Cài đặt')
    expect(link).toBeInTheDocument()
    expect(link.closest('a')).toHaveAttribute('href', '/settings')
  })
})
