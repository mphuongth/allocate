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
})
