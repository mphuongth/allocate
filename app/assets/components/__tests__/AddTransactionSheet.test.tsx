import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

  it('contains overscroll and clips horizontal overflow so the modal cannot be dragged around', () => {
    const { container } = render(<AddTransactionSheet open onClose={vi.fn()} />)
    const scrollers = Array.from(container.querySelectorAll<HTMLElement>('div')).filter(
      (el) => el.style.overflowY === 'auto'
    )
    expect(scrollers.length).toBeGreaterThan(0)
    for (const el of scrollers) {
      expect(el.style.overscrollBehavior).toBe('contain')
      // overflowX:auto would let any horizontal overflow pan the whole sheet sideways
      expect(el.style.overflowX).toBe('hidden')
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

describe('AddTransactionSheet — gold unit (issue #232)', () => {
  // Gold is valued per chỉ, so a lượng entry must be normalized: 1 lượng = 10 chỉ.
  it('normalizes a lượng entry to chỉ on save', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }))
    vi.stubGlobal('fetch', fetchMock)

    render(<AddTransactionSheet open onClose={vi.fn()} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByText('Gold'))          // asset type
    fireEvent.click(screen.getByText('unitLuong'))      // unit = lượng
    fireEvent.change(screen.getByPlaceholderText('1'), { target: { value: '1' } })           // 1 lượng
    fireEvent.change(screen.getByPlaceholderText('9,200,000'), { target: { value: '92000000' } }) // ₫/lượng
    fireEvent.click(screen.getByText('save'))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([u]) => String(u).includes('/investment-transactions'))
      expect(post).toBeTruthy()
      const body = JSON.parse((post![1] as RequestInit).body as string)
      expect(body.units).toBe(10)              // 1 lượng → 10 chỉ
      expect(body.unit_price).toBe(9_200_000)  // ₫ per chỉ
      expect(body.amount_vnd).toBe(92_000_000) // total unchanged
    })
  })
})
