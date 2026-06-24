import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FundsEmptyState } from '../FundsEmptyState'

// Mock next-intl so t('key') returns the key — keeps assertions language-agnostic.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

describe('FundsEmptyState', () => {
  it('renders the empty title, description and add action', () => {
    render(<FundsEmptyState onAdd={() => {}} />)
    expect(screen.getByText('empty')).toBeInTheDocument()
    expect(screen.getByText('emptyDesc')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument()
  })

  it('calls onAdd when the add button is clicked', () => {
    const onAdd = vi.fn()
    render(<FundsEmptyState onAdd={onAdd} />)
    fireEvent.click(screen.getByRole('button', { name: /add/i }))
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('uses a lucide icon + design tokens, not the 📚 emoji (#5)', () => {
    const { container } = render(<FundsEmptyState onAdd={() => {}} />)
    // Hero glyph is a lucide SVG now, not an emoji.
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.innerHTML).not.toMatch(/📚/)
    // No raw hex colors — tokens only.
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{6}/)
  })
})
