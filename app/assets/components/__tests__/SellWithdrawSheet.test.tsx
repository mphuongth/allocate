import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SellWithdrawSheet } from '../SellWithdrawSheet'

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string) => key,
}))

beforeEach(() => {
  document.body.style.overflow = ''
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})

describe('SellWithdrawSheet — bank withdraw (received + principal portion)', () => {
  it('defaults received to current value and posts received + principal portion', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
    vi.stubGlobal('fetch', fetchMock)

    const item = {
      type: 'bank' as const, name: 'Techcombank',
      currentValue: 5_200_000, interestRate: 6,
      transactionId: 't1', purchasePrice: 5_000_000,
    }
    render(<SellWithdrawSheet item={item} open context="unallocated" onClose={vi.fn()} onSuccess={vi.fn()} />)

    fireEvent.click(screen.getByTestId('sell-all-btn'))   // amount + received = 5,200,000
    fireEvent.click(screen.getByTestId('sell-confirm-btn'))

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

describe('SellWithdrawSheet — links the withdrawal to its goal (issue #261)', () => {
  it('posts goal_id when withdrawing in a goal context', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
    vi.stubGlobal('fetch', fetchMock)

    const item = {
      type: 'bank' as const, name: 'Techcombank',
      currentValue: 5_000_000, interestRate: 6,
      transactionId: 't1', purchasePrice: 5_000_000,
    }
    render(<SellWithdrawSheet item={item} open context="goal" goalId="goal-1" onClose={vi.fn()} onSuccess={vi.fn()} />)

    fireEvent.click(screen.getByTestId('sell-all-btn'))
    fireEvent.click(screen.getByTestId('sell-confirm-btn'))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String(c[0]).includes('/investment-transactions'))
      const body = JSON.parse(String((post![1] as RequestInit).body))
      expect(body.goal_id).toBe('goal-1')           // linked so the goal-detail fetch returns it
      expect(body.parent_transaction_id).toBe('t1')
    })
  })

  it('keeps goal_id null in the unallocated context', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
    vi.stubGlobal('fetch', fetchMock)

    const item = {
      type: 'bank' as const, name: 'Techcombank',
      currentValue: 5_000_000, interestRate: 6,
      transactionId: 't1', purchasePrice: 5_000_000,
    }
    render(<SellWithdrawSheet item={item} open context="unallocated" onClose={vi.fn()} onSuccess={vi.fn()} />)

    fireEvent.click(screen.getByTestId('sell-all-btn'))
    fireEvent.click(screen.getByTestId('sell-confirm-btn'))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String(c[0]).includes('/investment-transactions'))
      const body = JSON.parse(String((post![1] as RequestInit).body))
      expect(body.goal_id).toBeNull()
    })
  })
})

describe('SellWithdrawSheet — count toward goal progress toggle', () => {
  const bankItem = {
    type: 'bank' as const, name: 'Techcombank',
    currentValue: 5_000_000, interestRate: 6,
    transactionId: 't1', purchasePrice: 5_000_000,
  }

  it('shows the toggle in goal context and posts affects_progress=true by default', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
    vi.stubGlobal('fetch', fetchMock)

    render(<SellWithdrawSheet item={bankItem} open context="goal" goalId="g1" goalCurrentValue={20_000_000} goalTargetAmount={50_000_000} onClose={vi.fn()} onSuccess={vi.fn()} />)

    expect(screen.getByTestId('affects-progress-control')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('sell-all-btn'))
    fireEvent.click(screen.getByTestId('sell-confirm-btn'))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String(c[0]).includes('/investment-transactions'))
      const body = JSON.parse(String((post![1] as RequestInit).body))
      expect(body.affects_progress).toBe(true)
    })
  })

  it('posts affects_progress=false after toggling the switch off', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
    vi.stubGlobal('fetch', fetchMock)

    render(<SellWithdrawSheet item={bankItem} open context="goal" goalId="g1" goalCurrentValue={20_000_000} goalTargetAmount={50_000_000} onClose={vi.fn()} onSuccess={vi.fn()} />)

    fireEvent.click(screen.getByTestId('affects-progress-switch'))
    fireEvent.click(screen.getByTestId('sell-all-btn'))
    fireEvent.click(screen.getByTestId('sell-confirm-btn'))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String(c[0]).includes('/investment-transactions'))
      const body = JSON.parse(String((post![1] as RequestInit).body))
      expect(body.affects_progress).toBe(false)
    })
  })

  it('hides the toggle in the unallocated context', () => {
    render(<SellWithdrawSheet item={bankItem} open context="unallocated" onClose={vi.fn()} onSuccess={vi.fn()} />)
    expect(screen.queryByTestId('affects-progress-control')).not.toBeInTheDocument()
  })
})

describe('SellWithdrawSheet — gold sell (quantity × price) (issue #232)', () => {
  it('prefills the price and posts proceeds + cost basis', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
    vi.stubGlobal('fetch', fetchMock)

    const item = {
      type: 'gold' as const, name: 'PNJ Gold',
      currentValue: 9_200_000, units: 1, navPerUnit: 9_200_000,
      transactionId: 'g1', purchasePrice: 9_000_000,
    }
    render(<SellWithdrawSheet item={item} open context="unallocated" onClose={vi.fn()} onSuccess={vi.fn()} />)

    // Sale price prefills to the current price (9,200,000); sell 1 chỉ.
    fireEvent.change(screen.getByTestId('sell-gold-qty-input'), { target: { value: '1' } })
    fireEvent.click(screen.getByTestId('sell-confirm-btn'))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String(c[0]).includes('/investment-transactions'))
      expect(post).toBeTruthy()
      const body = JSON.parse(String((post![1] as RequestInit).body))
      expect(body.asset_type).toBe('gold')
      expect(body.parent_transaction_id).toBe('g1')
      expect(body.units_withdrawn).toBe(1)            // 1 chỉ
      expect(body.amount_vnd).toBe(9_200_000)         // proceeds = 1 × current price
      expect(body.principal_withdrawn).toBe(9_000_000) // cost basis = 9,000,000 / 1 × 1
    })
  })
})

describe('SellWithdrawSheet — responsive presentation (#248)', () => {
  const item = {
    type: 'fund' as const, name: 'VESAF',
    currentValue: 10_000_000, units: 100, navPerUnit: 100_000,
    fundId: 'f1', purchasePrice: 9_000_000,
  }

  it('docks to the bottom as a sheet on mobile', () => {
    render(<SellWithdrawSheet item={item} open context="unallocated" onClose={vi.fn()} onSuccess={vi.fn()} />)
    expect(screen.getByTestId('sell-sheet').style.alignItems).toBe('flex-end')
  })

  it('opens as a centered modal on desktop', () => {
    render(<SellWithdrawSheet item={item} open context="unallocated" desktop onClose={vi.fn()} onSuccess={vi.fn()} />)
    expect(screen.getByTestId('sell-sheet').style.alignItems).toBe('center')
  })

  // issue #256 — on desktop the item card sat flush against the header divider.
  it('pads the body below the header divider on desktop', () => {
    render(<SellWithdrawSheet item={item} open context="unallocated" desktop onClose={vi.fn()} onSuccess={vi.fn()} />)
    expect(screen.getByTestId('sell-body').style.paddingTop).toBe('16px')
  })
})
