import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SellWithdrawSheet } from '../SellWithdrawSheet'

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string) => key,
}))

beforeEach(() => {
  document.body.style.overflow = ''
  vi.stubGlobal('fetch', vi.fn((_url?: string, _init?: RequestInit) => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})

describe('SellWithdrawSheet — bank withdraw (received + principal portion)', () => {
  it('defaults received to current value and posts received + principal portion', async () => {
    const fetchMock = vi.fn((_url?: string, _init?: RequestInit) =>
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

// The existing coverage above only exercises a FULL withdrawal, where the old
// proportional conversion happened to return the whole principal — so it stayed
// green while every partial withdrawal recorded the wrong principal (#578).
describe('SellWithdrawSheet — partial bank withdrawal where value != principal (#578)', () => {
  // The reported PVcombank book: 20,385,398 of app value on 20,239,452 of
  // principal. The user asks the bank for 4,365,100 and receives 4,366,416.
  const book = {
    type: 'bank' as const, name: 'PVcombank',
    currentValue: 20_385_398, interestRate: 5.5,
    transactionId: 't1', purchasePrice: 20_239_452,
  }

  function enterWithdrawal() {
    fireEvent.change(screen.getByTestId('sell-amount-input'), { target: { value: '4365100' } })
    fireEvent.change(screen.getByTestId('sell-received-input'), { target: { value: '4366416' } })
  }

  it('previews the entered amount as the principal withdrawn', () => {
    render(<SellWithdrawSheet item={book} open context="unallocated" onClose={vi.fn()} onSuccess={vi.fn()} />)
    enterWithdrawal()
    // The old proportional conversion previewed 4.333.849 here.
    expect(screen.getByTestId('sell-bank-principal')).toHaveTextContent('4.365.100')
  })

  it('previews the interest the bank actually paid', () => {
    render(<SellWithdrawSheet item={book} open context="unallocated" onClose={vi.fn()} onSuccess={vi.fn()} />)
    enterWithdrawal()
    expect(screen.getByTestId('sell-bank-gain')).toHaveTextContent('1.316')
  })

  it('previews the principal the bank says remains', () => {
    render(<SellWithdrawSheet item={book} open context="unallocated" onClose={vi.fn()} onSuccess={vi.fn()} />)
    enterWithdrawal()
    // Remaining PRINCIPAL, not remaining value — it is what the next withdrawal
    // is capped against, and what depositValuation reduces.
    expect(screen.getByTestId('sell-bank-remaining')).toHaveTextContent('15.874.352')
  })

  it('posts the entered principal and the received cash unchanged', async () => {
    const fetchMock = vi.fn((_url?: string, _init?: RequestInit) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
    vi.stubGlobal('fetch', fetchMock)

    render(<SellWithdrawSheet item={book} open context="unallocated" onClose={vi.fn()} onSuccess={vi.fn()} />)
    enterWithdrawal()
    fireEvent.click(screen.getByTestId('sell-confirm-btn'))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String(c[0]).includes('/investment-transactions'))
      const body = JSON.parse(String((post![1] as RequestInit).body))
      expect(body.principal_withdrawn).toBe(4_365_100)
      expect(body.amount_vnd).toBe(4_366_416)
    })
  })

  it('caps the withdrawal at the remaining principal, not the current value', () => {
    render(<SellWithdrawSheet item={book} open context="unallocated" onClose={vi.fn()} onSuccess={vi.fn()} />)
    // Between principal and current value: the old cap allowed this, and then
    // silently scaled the recorded principal down to fit.
    fireEvent.change(screen.getByTestId('sell-amount-input'), { target: { value: '20300000' } })
    expect(screen.getByTestId('sell-confirm-btn')).toBeDisabled()
  })

  it('prefills the received amount with the interest accrued on that principal', () => {
    render(<SellWithdrawSheet item={book} open context="unallocated" onClose={vi.fn()} onSuccess={vi.fn()} />)
    fireEvent.change(screen.getByTestId('sell-amount-input'), { target: { value: '4365100' } })
    // Principal alone would record a withdrawal that earned nothing; the user
    // still edits this down to the slip when an early withdrawal cuts interest.
    const received = screen.getByTestId('sell-received-input') as HTMLInputElement
    expect(Number(received.value.replace(/\./g, ''))).toBe(4_396_577)
  })

  it('fills the remaining principal — and the full current value — from "All"', () => {
    render(<SellWithdrawSheet item={book} open context="unallocated" onClose={vi.fn()} onSuccess={vi.fn()} />)
    fireEvent.click(screen.getByTestId('sell-all-btn'))
    const amount = screen.getByTestId('sell-amount-input') as HTMLInputElement
    const received = screen.getByTestId('sell-received-input') as HTMLInputElement
    expect(Number(amount.value.replace(/\./g, ''))).toBe(20_239_452)
    expect(Number(received.value.replace(/\./g, ''))).toBe(20_385_398)
    expect(screen.getByTestId('sell-confirm-btn')).not.toBeDisabled()
  })
})

// The goal-progress preview subtracts its input from the goal's VALUE, and after
// saving, valueNonFundHolding revalues the holding from the remaining principal:
// the goal drops by the withdrawn principal plus its projected interest
// (calcProjectedInterest is linear in principal, so that slice is exact). The cash
// received never enters that calculation — it leaves for Unallocated.
describe('SellWithdrawSheet — goal-progress preview tracks the value released, not the payout', () => {
  // 20M principal carrying 4M of accrued interest, in a goal worth exactly its
  // target. Withdrawing half the principal releases 10M + 2M = 12M of value.
  const book = {
    type: 'bank' as const, name: 'PVcombank',
    currentValue: 24_000_000, interestRate: 6,
    transactionId: 't1', purchasePrice: 20_000_000,
  }
  const goalProps = { context: 'goal' as const, goalId: 'g1', goalCurrentValue: 24_000_000, goalTargetAmount: 24_000_000 }

  it('previews the drop from the value released', () => {
    render(<SellWithdrawSheet item={book} open {...goalProps} onClose={vi.fn()} onSuccess={vi.fn()} />)
    fireEvent.change(screen.getByTestId('sell-amount-input'), { target: { value: '10000000' } })
    const control = screen.getByTestId('affects-progress-control')
    // 24M → 12M of 24M = 50%. Using the payout would leave 14M → 58%.
    expect(control).toHaveTextContent('50%')
    expect(control).not.toHaveTextContent('58%')
  })

  it('does not shrink the previewed drop when an early withdrawal forfeits the interest', () => {
    render(<SellWithdrawSheet item={book} open {...goalProps} onClose={vi.fn()} onSuccess={vi.fn()} />)
    fireEvent.change(screen.getByTestId('sell-amount-input'), { target: { value: '10000000' } })
    // The bank pays back principal only — but the holding is still revalued from
    // the remaining principal, so the goal falls by the same 12M either way. A
    // preview keyed off the payout would promise a smaller drop than it delivers.
    fireEvent.change(screen.getByTestId('sell-received-input'), { target: { value: '10000000' } })
    expect(screen.getByTestId('affects-progress-control')).toHaveTextContent('50%')
  })
})

describe('SellWithdrawSheet — links the withdrawal to its goal (issue #261)', () => {
  it('posts goal_id when withdrawing in a goal context', async () => {
    const fetchMock = vi.fn((_url?: string, _init?: RequestInit) =>
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
    const fetchMock = vi.fn((_url?: string, _init?: RequestInit) =>
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

describe('SellWithdrawSheet — iOS zoom guard (issue #265)', () => {
  // iOS Safari zooms when a focused native field is < 16px. The amount and
  // received inputs must render at >= 16px on mobile.
  it('renders the sell amount and received inputs at >=16px', () => {
    const item = {
      type: 'bank' as const, name: 'Techcombank',
      currentValue: 5_000_000, interestRate: 6,
      transactionId: 't1', purchasePrice: 5_000_000,
    }
    render(<SellWithdrawSheet item={item} open context="unallocated" onClose={vi.fn()} onSuccess={vi.fn()} />)
    for (const id of ['sell-amount-input', 'sell-received-input']) {
      const el = screen.getByTestId(id)
      expect(parseFloat(getComputedStyle(el).fontSize)).toBeGreaterThanOrEqual(16)
    }
  })
})

describe('SellWithdrawSheet — count toward goal progress toggle', () => {
  const bankItem = {
    type: 'bank' as const, name: 'Techcombank',
    currentValue: 5_000_000, interestRate: 6,
    transactionId: 't1', purchasePrice: 5_000_000,
  }

  it('shows the toggle in goal context and posts affects_progress=true by default', async () => {
    const fetchMock = vi.fn((_url?: string, _init?: RequestInit) => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
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
    const fetchMock = vi.fn((_url?: string, _init?: RequestInit) => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
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
    const fetchMock = vi.fn((_url?: string, _init?: RequestInit) =>
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

describe('SellWithdrawSheet — error path shows a real message (not a raw i18n key)', () => {
  // Regression: the catch/!res.ok paths used useTranslations('Dashboard').t('sellError'),
  // but that namespace/key never existed → the error path leaked a raw key or threw.
  it('renders a localized error when the withdrawal fails without a server message', async () => {
    vi.stubGlobal('fetch', vi.fn((_url?: string, _init?: RequestInit) => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })))

    const item = {
      type: 'bank' as const, name: 'Techcombank',
      currentValue: 5_000_000, interestRate: 6,
      transactionId: 't1', purchasePrice: 5_000_000,
    }
    render(<SellWithdrawSheet item={item} open context="unallocated" onClose={vi.fn()} onSuccess={vi.fn()} />)

    fireEvent.click(screen.getByTestId('sell-all-btn'))
    fireEvent.click(screen.getByTestId('sell-confirm-btn'))

    await waitFor(() => {
      expect(screen.getByText(/an error occurred|please try again/i)).toBeInTheDocument()
    })
    // Must not leak the i18n key or its (wrong) namespace.
    expect(screen.queryByText(/sellError|Dashboard\./)).not.toBeInTheDocument()
  })
})

describe('SellWithdrawSheet — summary strip, tax & bank warning (moved off dashboard E2E)', () => {
  const fundItem = {
    type: 'fund' as const, name: 'VESAF',
    currentValue: 10_000_000, units: 100, navPerUnit: 100_000,
    fundId: 'f1', purchasePrice: 9_000_000,
  }
  const bankItem = {
    type: 'bank' as const, name: 'Techcombank',
    currentValue: 5_000_000, interestRate: 6,
    transactionId: 't1', purchasePrice: 5_000_000,
  }

  it('shows the remaining amount in the summary strip after entering an amount', () => {
    render(<SellWithdrawSheet item={fundItem} open context="unallocated" onClose={vi.fn()} onSuccess={vi.fn()} />)
    fireEvent.change(screen.getByTestId('sell-amount-input'), { target: { value: '1000000' } })
    const strip = screen.getByTestId('sell-summary-strip')
    expect(strip).toBeInTheDocument()
    expect(strip).toHaveTextContent(/Remaining after transaction/i)
  })

  it('shows the 0.1% personal income tax row for a fund sell', () => {
    render(<SellWithdrawSheet item={fundItem} open context="unallocated" onClose={vi.fn()} onSuccess={vi.fn()} />)
    fireEvent.change(screen.getByTestId('sell-amount-input'), { target: { value: '1000000' } })
    const taxRow = screen.getByTestId('sell-tax-row')
    expect(taxRow).toBeInTheDocument()
    // 0.1% of 1,000,000 = 1,000 (label carries the rate).
    expect(taxRow).toHaveTextContent(/0\.1%/)
    expect(taxRow).toHaveTextContent('1.000')
  })

  it('the "All" button fills the input with the full available amount', () => {
    render(<SellWithdrawSheet item={fundItem} open context="unallocated" onClose={vi.fn()} onSuccess={vi.fn()} />)
    fireEvent.click(screen.getByTestId('sell-all-btn'))
    const input = screen.getByTestId('sell-amount-input') as HTMLInputElement
    // vi-VN grouping uses dots as thousand separators.
    expect(Number(input.value.replace(/\./g, ''))).toBe(10_000_000)
  })

  it('shows the early-withdrawal warning for a bank withdrawal', () => {
    render(<SellWithdrawSheet item={bankItem} open context="unallocated" onClose={vi.fn()} onSuccess={vi.fn()} />)
    const warning = screen.getByTestId('sell-bank-warning')
    expect(warning).toBeInTheDocument()
    expect(warning).toHaveTextContent(/early withdrawal/i)
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

// #705: the maturity sheet's "Tổng nhận về" is now editable, and this is where
// that number has to land. Opening the withdraw sheet from a maturity close means
// the whole book goes: the amount is the full principal, and the cash is whatever
// the user already told the maturity sheet the bank paid — not the estimate this
// sheet would compute for itself.
describe('SellWithdrawSheet — a payout carried over from the maturity sheet (#705)', () => {
  const book = {
    type: 'bank' as const, name: 'Vikki',
    currentValue: 54_890_294, interestRate: 4.7,
    transactionId: 't9', purchasePrice: 52_400_000,
  }

  it('opens on the full principal with the carried payout as the cash received', () => {
    render(
      <SellWithdrawSheet item={book} open context="unallocated" receivedPrefill={54_500_000} onClose={vi.fn()} onSuccess={vi.fn()} />,
    )
    expect((screen.getByTestId('sell-amount-input') as HTMLInputElement).value).toBe('52.400.000')
    expect((screen.getByTestId('sell-received-input') as HTMLInputElement).value).toBe('54.500.000')
  })

  it('leaves the sheet blank when no payout was carried over', () => {
    render(<SellWithdrawSheet item={book} open context="unallocated" onClose={vi.fn()} onSuccess={vi.fn()} />)
    expect((screen.getByTestId('sell-amount-input') as HTMLInputElement).value).toBe('')
    expect((screen.getByTestId('sell-received-input') as HTMLInputElement).value).toBe('')
  })
})
