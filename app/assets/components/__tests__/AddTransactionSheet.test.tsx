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

describe('AddTransactionSheet — fund sell units field (two-way linked)', () => {
  it('entering units fills the amount and posts the matching withdrawal', async () => {
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

    fireEvent.click(screen.getByText('sell'))
    await screen.findAllByText(/VESAF/)
    fireEvent.change(screen.getByTestId('sell-fund-units-input'), { target: { value: '50' } })  // 50 units
    fireEvent.click(screen.getByText('confirmSale'))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String(c[0]).includes('/investment-transactions'))
      expect(post).toBeTruthy()
      const body = JSON.parse(String((post![1] as RequestInit).body))
      expect(body.asset_type).toBe('fund')
      expect(body.amount_vnd).toBe(1_000_000)        // 50 × 20,000 NAV
      expect(body.units_withdrawn).toBe(50)
      expect(body.principal_withdrawn).toBe(900_000)  // 50% of cost basis
    })
  })
})

describe('AddTransactionSheet — bank withdraw (received + principal portion)', () => {
  it('defaults received to current value and posts received + principal portion', async () => {
    const overview = {
      goals: [{ goalName: 'Goal A', funds: [], nonFunds: [{ transactionId: 't1', type: 'bank', amount: 5_000_000, currentValue: 5_200_000, interestRate: 6, units: null, notes: 'Techcombank' }] }],
      unallocated: { funds: [], nonFunds: [] },
    }
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (String(url).includes('/dashboard/overview')) return Promise.resolve({ ok: true, json: () => Promise.resolve(overview) })
      if (String(url).includes('/savings-goals')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ goals: [] }) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AddTransactionSheet open onClose={vi.fn()} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByText('Bank'))
    fireEvent.click(screen.getByText('withdraw'))
    await screen.findAllByText(/Techcombank/)
    fireEvent.click(screen.getByText('all'))   // amount = 5,200,000 → received defaults to 5,200,000
    fireEvent.click(screen.getByText('confirmWithdrawal'))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String(c[0]).includes('/investment-transactions'))
      expect(post).toBeTruthy()
      const body = JSON.parse(String((post![1] as RequestInit).body))
      expect(body.asset_type).toBe('bank')
      expect(body.parent_transaction_id).toBe('t1')
      expect(body.amount_vnd).toBe(5_200_000)         // cash received
      expect(body.principal_withdrawn).toBe(5_000_000) // full principal removed
    })
  })
})

describe('AddTransactionSheet — sell lists goal-allocated bank/gold (issue #232)', () => {
  it('includes bank/gold holdings attributed to a goal, not just unallocated', async () => {
    const overview = {
      goals: [{ goalName: 'Goal A', funds: [], nonFunds: [{ transactionId: 't1', type: 'bank', amount: 5_000_000, currentValue: 5_200_000, interestRate: 6, units: null, notes: 'Techcombank' }] }],
      unallocated: { funds: [], nonFunds: [] },
    }
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (String(url).includes('/dashboard/overview')) return Promise.resolve({ ok: true, json: () => Promise.resolve(overview) })
      if (String(url).includes('/savings-goals')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ goals: [] }) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AddTransactionSheet open onClose={vi.fn()} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByText('Bank'))      // asset type = bank
    fireEvent.click(screen.getByText('withdraw'))  // sell direction (bank → Withdraw)

    expect(await screen.findAllByText(/Techcombank/)).not.toHaveLength(0)
  })
})

describe('AddTransactionSheet — gold sell (quantity × price) (issue #232)', () => {
  it('sells gold by quantity (chỉ) and posts proceeds + cost basis', async () => {
    const overview = {
      goals: [],
      unallocated: { funds: [], nonFunds: [{ transactionId: 'g1', type: 'gold', amount: 9_000_000, currentValue: 9_200_000, interestRate: null, units: 1, notes: 'PNJ' }] },
    }
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (String(url).includes('/dashboard/overview')) return Promise.resolve({ ok: true, json: () => Promise.resolve(overview) })
      if (String(url).includes('/savings-goals')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ goals: [] }) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AddTransactionSheet open onClose={vi.fn()} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByText('Gold'))    // asset type = gold
    fireEvent.click(screen.getByText('sell'))    // direction = sell
    await screen.findAllByText(/PNJ/)             // gold holding loaded (price prefills to 9,200,000)
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '1' } })  // 1 chỉ
    fireEvent.click(screen.getByText('confirmSale'))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String(c[0]).includes('/investment-transactions'))
      expect(post).toBeTruthy()
      const body = JSON.parse(String((post![1] as RequestInit).body))
      expect(body.transaction_type).toBe('withdrawal')
      expect(body.asset_type).toBe('gold')
      expect(body.parent_transaction_id).toBe('g1')
      expect(body.units_withdrawn).toBe(1)            // 1 chỉ
      expect(body.amount_vnd).toBe(9_200_000)         // proceeds = 1 × current price
      expect(body.principal_withdrawn).toBe(9_000_000) // cost basis (amount / units × 1)
    })
  })
})

describe('AddTransactionSheet — bank term interest receivable (issue #245)', () => {
  // The box should show the interest the user actually receives by maturity,
  // prorated over the deposit term — not the full-year interest.
  it('prorates interest to the maturity date instead of showing interest/yr', () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }))
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(<AddTransactionSheet open onClose={vi.fn()} />)

    fireEvent.click(screen.getByText('Bank'))   // asset type = bank ('term' is default)
    fireEvent.change(screen.getByPlaceholderText('10,000,000'), { target: { value: '100000000' } })
    fireEvent.change(screen.getByPlaceholderText('5.5'), { target: { value: '6' } })

    // DOM order: [0] = maturity (bank section), [1] = transaction date (footer)
    const dateInputs = container.querySelectorAll<HTMLInputElement>('input[type="date"]')
    fireEvent.change(dateInputs[1], { target: { value: '2026-01-01' } })
    fireEvent.change(dateInputs[0], { target: { value: '2026-07-01' } })

    const termDays = (Date.parse('2026-07-01') - Date.parse('2026-01-01')) / 86_400_000  // 181
    const expected = Math.round((100_000_000 * 6 / 100) * termDays / 365)
    expect(screen.getByText('estInterestReceivable')).toBeInTheDocument()
    expect(screen.getByText(`+${expected.toLocaleString('vi-VN')} ₫`)).toBeInTheDocument()
    // The old per-year figure (6,000,000 ₫) must NOT be shown.
    expect(screen.queryByText(`+${(6_000_000).toLocaleString('vi-VN')} ₫`)).not.toBeInTheDocument()
    expect(screen.queryByText('estInterestYr')).not.toBeInTheDocument()
  })

  it('hides the interest box until a maturity date is set', () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }))
    vi.stubGlobal('fetch', fetchMock)

    render(<AddTransactionSheet open onClose={vi.fn()} />)

    fireEvent.click(screen.getByText('Bank'))
    fireEvent.change(screen.getByPlaceholderText('10,000,000'), { target: { value: '100000000' } })
    fireEvent.change(screen.getByPlaceholderText('5.5'), { target: { value: '6' } })

    expect(screen.queryByText('estInterestReceivable')).not.toBeInTheDocument()
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
