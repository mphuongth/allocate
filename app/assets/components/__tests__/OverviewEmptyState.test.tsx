import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OverviewEmptyState } from '../OverviewEmptyState'

// Mock next-intl so t('key') returns the key — keeps assertions language-agnostic.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

describe('OverviewEmptyState', () => {
  it('renders the three onboarding actions', () => {
    render(<OverviewEmptyState onAddGoal={() => {}} onAddInsurance={() => {}} />)
    expect(screen.getByText('addGoal')).toBeInTheDocument()
    expect(screen.getByText('addFund')).toBeInTheDocument()
    expect(screen.getByText('addInsurance')).toBeInTheDocument()
  })

  it('opens the in-page goal sheet instead of navigating to settings (#1)', () => {
    const onAddGoal = vi.fn()
    render(<OverviewEmptyState onAddGoal={onAddGoal} onAddInsurance={() => {}} />)
    fireEvent.click(screen.getByText('addGoal'))
    expect(onAddGoal).toHaveBeenCalledTimes(1)
  })

  it('opens the in-page insurance sheet for the insurance action (#1)', () => {
    const onAddInsurance = vi.fn()
    render(<OverviewEmptyState onAddGoal={() => {}} onAddInsurance={onAddInsurance} />)
    fireEvent.click(screen.getByText('addInsurance'))
    expect(onAddInsurance).toHaveBeenCalledTimes(1)
  })

  it('points the fund action at the funds library page', () => {
    const { container } = render(<OverviewEmptyState onAddGoal={() => {}} onAddInsurance={() => {}} />)
    const fundLink = container.querySelector('a[href="/funds"]')
    expect(fundLink).not.toBeNull()
    expect(fundLink).toHaveTextContent('addFund')
  })

  it('lifts the action card on hover (shadow-pop) and resets on leave', () => {
    render(<OverviewEmptyState onAddGoal={() => {}} onAddInsurance={() => {}} />)
    const card = screen.getByText('addGoal').closest('button') as HTMLButtonElement
    expect(card).not.toBeNull()
    expect(card.style.boxShadow).toBe('var(--shadow-card)')
    fireEvent.mouseEnter(card)
    expect(card.style.boxShadow).toBe('var(--shadow-pop)')
    fireEvent.mouseLeave(card)
    expect(card.style.boxShadow).toBe('var(--shadow-card)')
  })

  it('uses Cairn design tokens, not raw Tailwind indigo/emoji (#1)', () => {
    const { container } = render(<OverviewEmptyState onAddGoal={() => {}} onAddInsurance={() => {}} />)
    // No leftover indigo utility classes from the pre-migration markup.
    expect(container.querySelector('[class*="indigo"]')).toBeNull()
    // No emoji glyphs — icons are lucide SVGs now.
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.innerHTML).not.toMatch(/📊|🎯|💰|🛡️/)
  })
})
