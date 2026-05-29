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

describe('AddTransactionSheet — goal selector (issue #232)', () => {
  // /api/v1/savings-goals returns { goals: [...] }, not a bare array — the goal
  // selector must read that shape or it stays empty/hidden.
  it('populates the goal select from the { goals } API shape', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('/savings-goals')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ goals: [{ goal_id: 'g1', goal_name: 'House Fund' }] }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AddTransactionSheet open onClose={vi.fn()} />)

    expect(await screen.findByText('House Fund')).toBeInTheDocument()
  })
})

describe('AddTransactionSheet — sell flow (issue #232)', () => {
  it('lists holdings from the overview and posts a fund withdrawal on confirm', async () => {
    const overview = {
      goals: [{ goalName: 'Goal A', funds: [{ fundId: 'f1', fundName: 'VESAF', quantity: 100, currentNAV: 20000, currentValue: 2_000_000, purchasePrice: 18000, profitLossPercentage: 11.11 }] }],
      unallocated: { funds: [], nonFunds: [] },
    }
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (String(url).includes('/dashboard/overview')) return Promise.resolve({ ok: true, json: () => Promise.resolve(overview) })
      if (String(url).includes('/savings-goals')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ goals: [] }) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AddTransactionSheet open onClose={vi.fn()} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByText('sell'))   // direction = sell → lazy-loads holdings
    await screen.findAllByText(/VESAF/)          // holding picker + summary populated
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '1000000' } })
    fireEvent.click(screen.getByText('confirmSale'))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String(c[0]).includes('/investment-transactions'))
      expect(post).toBeTruthy()
      const body = JSON.parse(String((post![1] as RequestInit).body))
      expect(body.transaction_type).toBe('withdrawal')
      expect(body.asset_type).toBe('fund')
      expect(body.fund_id).toBe('f1')
      expect(body.amount_vnd).toBe(1_000_000)
      expect(body.units_withdrawn).toBe(50)         // 1,000,000 / 20,000 NAV
      expect(body.principal_withdrawn).toBe(900_000) // 50% of cost basis (18,000 × 100)
    })
  })
})

describe('AddTransactionSheet — gold unit (issue #232)', () => {
  // Gold is valued per chỉ, so a lượng entry must be normalized: 1 lượng = 10 chỉ.
  it('normalizes a lượng entry to chỉ on save', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }))
    vi.stubGlobal('fetch', fetchMock)

    render(<AddTransactionSheet open onClose={vi.fn()} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByText('Gold'))          // asset type
    fireEvent.click(screen.getByText('unitLuong'))      // unit = lượng
    fireEvent.change(screen.getByPlaceholderText('1'), { target: { value: '1' } })           // 1 lượng
    fireEvent.change(screen.getByPlaceholderText('9,200,000'), { target: { value: '92000000' } }) // ₫/lượng
    fireEvent.click(screen.getByText('save'))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String(c[0]).includes('/investment-transactions'))
      expect(post).toBeTruthy()
      const body = JSON.parse(String((post![1] as RequestInit).body))
      expect(body.units).toBe(10)              // 1 lượng → 10 chỉ
      expect(body.unit_price).toBe(9_200_000)  // ₫ per chỉ
      expect(body.amount_vnd).toBe(92_000_000) // total unchanged
    })
  })
})
