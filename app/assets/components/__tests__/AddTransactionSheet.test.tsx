import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import AddTransactionSheet from '../AddTransactionSheet'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

beforeEach(() => {
  document.body.style.overflow = ''
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve([]) })))
})

describe('AddTransactionSheet — background scroll lock (issue #219)', () => {
  it('locks body scroll while open', () => {
    render(<AddTransactionSheet open onClose={vi.fn()} />)
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('restores body scroll when closed', () => {
    const { rerender } = render(<AddTransactionSheet open onClose={vi.fn()} />)
    expect(document.body.style.overflow).toBe('hidden')

    rerender(<AddTransactionSheet open={false} onClose={vi.fn()} />)
    expect(document.body.style.overflow).toBe('')
  })

  it('does not lock body scroll when never opened', () => {
    render(<AddTransactionSheet open={false} onClose={vi.fn()} />)
    expect(document.body.style.overflow).toBe('')
  })

  it('contains overscroll on the scrollable body so dragging does not move the modal around', () => {
    const { container } = render(<AddTransactionSheet open onClose={vi.fn()} />)
    const scrollers = Array.from(container.querySelectorAll<HTMLElement>('div')).filter(
      (el) => el.style.overflowY === 'auto'
    )
    expect(scrollers.length).toBeGreaterThan(0)
    for (const el of scrollers) {
      expect(el.style.overscrollBehavior).toBe('contain')
    }
  })

  it('renders inputs at 16px so focusing a field does not trigger iOS auto-zoom', () => {
    const { container } = render(<AddTransactionSheet open onClose={vi.fn()} />)
    const fields = container.querySelectorAll<HTMLElement>('input, select, textarea')
    expect(fields.length).toBeGreaterThan(0)
    for (const field of fields) {
      expect(parseFloat(getComputedStyle(field).fontSize)).toBeGreaterThanOrEqual(16)
    }
  })
})
