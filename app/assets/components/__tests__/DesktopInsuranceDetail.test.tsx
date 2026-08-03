import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import DesktopInsuranceDetail from '../DesktopInsuranceDetail'
import type { InsuranceData } from '@/features/dashboard/contracts'

const { toastErrorMock } = vi.hoisted(() => ({ toastErrorMock: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: vi.fn() } }))

const ins: InsuranceData = {
  insuranceId: 'ins-1',
  insuranceName: 'John Doe',
  coverageType: 'Self',
  annualPremium: 12_000_000,
  amountSaved: 2_500_000,
  savingsProgressPercentage: 20.8,
  status: 'upcoming',
  nextPaymentDate: '2026-08-01',
} as InsuranceData

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (typeof url === 'string' && url.includes('/savings')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          entries: [
            { id: 's1', amount: 1_500_000, date: '2026-03-15', kind: 'logged' },
            { id: 'plan-p1', amount: 1_000_000, date: '2026-03-01', kind: 'plan' },
          ],
          totalSaved: 2_500_000,
        }),
      })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  }))
})

describe('DesktopInsuranceDetail — payment history (issue #223)', () => {
  it('shows the exact logged amount, not a lossy compact value', async () => {
    render(<DesktopInsuranceDetail ins={ins} locale="en" onClose={vi.fn()} />)
    expect(await screen.findByText(/₫\s?1\.500\.000/)).toBeInTheDocument()
    expect(screen.queryByText('1.5M ₫')).not.toBeInTheDocument()
  })

  it('itemizes the auto monthly plan contribution alongside logged payments', async () => {
    render(<DesktopInsuranceDetail ins={ins} locale="en" onClose={vi.fn()} />)
    expect(await screen.findByText('Logged payment')).toBeInTheDocument()
    expect(screen.getByText('Monthly plan')).toBeInTheDocument()
    // logged uses its saved date (15 Mar), plan shows month/year
    expect(screen.getByText('15 Mar 2026')).toBeInTheDocument()
    expect(screen.getByText('Mar 2026')).toBeInTheDocument()
  })

  it('shows a total that reconciles with the Saved amount', async () => {
    render(<DesktopInsuranceDetail ins={ins} locale="en" onClose={vi.fn()} />)
    const total = await screen.findByTestId('insurance-history-total')
    // 1,500,000 + 1,000,000 = 2,500,000 == amountSaved
    expect(total).toHaveTextContent(/₫\s?2\.500\.000/)
  })
})

describe('DesktopInsuranceDetail — history load error vs empty', () => {
  it('shows a retry state (not "No payments yet") when the savings fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })))

    render(<DesktopInsuranceDetail ins={ins} locale="en" onClose={vi.fn()} />)

    expect(await screen.findByTestId('load-error')).toBeInTheDocument()
    expect(screen.queryByText('No payments yet')).not.toBeInTheDocument()
  })

  it('retry re-fetches and renders the history on success', async () => {
    let call = 0
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (typeof url === 'string' && url.includes('/savings')) {
        call += 1
        if (call === 1) return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ entries: [{ id: 's1', amount: 1_500_000, date: '2026-03-15', kind: 'logged' }] }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    }))

    render(<DesktopInsuranceDetail ins={ins} locale="en" onClose={vi.fn()} />)
    expect(await screen.findByTestId('load-error')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('load-error-retry'))

    expect(await screen.findByText('Logged payment')).toBeInTheDocument()
    expect(screen.queryByTestId('load-error')).not.toBeInTheDocument()
  })
})

describe('DesktopInsuranceDetail — delete a logged payment', () => {
  it('deletes the logged savings row, re-fetches history and signals onChanged', async () => {
    let deletedId: string | null = null
    let savingsCall = 0
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/insurance-savings/') && init?.method === 'DELETE') {
        deletedId = url.split('/insurance-savings/')[1]
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      }
      if (typeof url === 'string' && url.includes('/savings')) {
        savingsCall += 1
        const entries = savingsCall === 1
          ? [{ id: 's1', amount: 1_500_000, date: '2026-03-15', kind: 'logged' }]
          : []
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ entries, totalSaved: savingsCall === 1 ? 1_500_000 : 0 }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    }))
    const onChanged = vi.fn()
    render(<DesktopInsuranceDetail ins={ins} locale="en" onClose={vi.fn()} onChanged={onChanged} />)

    await screen.findByText('Logged payment')
    fireEvent.click(screen.getByTestId('insurance-delete-savings-s1'))
    fireEvent.click(screen.getByTestId('insurance-delete-savings-confirm'))

    await waitFor(() => expect(deletedId).toBe('s1'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    // History re-fetched → the row is gone.
    await waitFor(() => expect(screen.queryByText('Logged payment')).not.toBeInTheDocument())
  })

  it('shows an error toast and keeps the row when the delete fails', async () => {
    toastErrorMock.mockClear()
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/insurance-savings/') && init?.method === 'DELETE') {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
      }
      if (typeof url === 'string' && url.includes('/savings')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ entries: [{ id: 's1', amount: 1_500_000, date: '2026-03-15', kind: 'logged' }], totalSaved: 1_500_000 }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    }))
    render(<DesktopInsuranceDetail ins={ins} locale="en" onClose={vi.fn()} onChanged={vi.fn()} />)

    await screen.findByText('Logged payment')
    fireEvent.click(screen.getByTestId('insurance-delete-savings-s1'))
    fireEvent.click(screen.getByTestId('insurance-delete-savings-confirm'))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled())
    expect(screen.getByText('Logged payment')).toBeInTheDocument()
  })

  it('does not offer delete on an auto monthly-plan entry (not a stored row)', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (typeof url === 'string' && url.includes('/savings')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ entries: [{ id: 'plan-p1', amount: 1_000_000, date: '2026-03-01', kind: 'plan' }], totalSaved: 1_000_000 }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    }))
    render(<DesktopInsuranceDetail ins={ins} locale="en" onClose={vi.fn()} onChanged={vi.fn()} />)

    await screen.findByText('Monthly plan')
    expect(screen.queryByTestId('insurance-delete-savings-plan-p1')).not.toBeInTheDocument()
  })
})

describe('DesktopInsuranceDetail — delete failure feedback', () => {
  it('shows an error toast and keeps the member (no onChanged/onClose) when the delete fails', async () => {
    toastErrorMock.mockClear()
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('insurance-members') && init?.method === 'DELETE') {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
      }
      if (typeof url === 'string' && url.includes('/savings')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ entries: [], totalSaved: 0 }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    }))
    const onChanged = vi.fn()
    const onClose = vi.fn()

    render(<DesktopInsuranceDetail ins={ins} locale="en" onClose={onClose} onChanged={onChanged} />)

    fireEvent.click(screen.getByTestId('insurance-remove-btn'))
    fireEvent.click(screen.getByTestId('insurance-remove-confirm'))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled())
    expect(onChanged).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('DesktopInsuranceDetail — header presence (moved off dashboard E2E)', () => {
  it('shows avatar initials derived from the member name, not just a shield icon', () => {
    render(<DesktopInsuranceDetail ins={ins} locale="en" onClose={vi.fn()} />)
    const avatar = screen.getByTestId('insurance-avatar')
    expect(avatar).toBeInTheDocument()
    // "John Doe" → "JD" (1–2 uppercase letters).
    expect(avatar.textContent?.trim()).toMatch(/^[A-ZÀ-Ỹ]{1,2}$/)
  })

  it('exposes a Remove member control', () => {
    render(<DesktopInsuranceDetail ins={ins} locale="en" onClose={vi.fn()} />)
    expect(screen.getByTestId('insurance-remove-btn')).toBeInTheDocument()
  })
})

describe('DesktopInsuranceDetail — edit-form labels are accurate', () => {
  it('labels the relationship picker "Relationship" and the date "Payment date" (not "Coverage type"/"Start date")', () => {
    render(<DesktopInsuranceDetail ins={ins} locale="en" onClose={vi.fn()} />)
    fireEvent.click(screen.getByTestId('insurance-edit-btn'))

    expect(screen.getByText('Relationship')).toBeInTheDocument()
    expect(screen.queryByText('Coverage type')).not.toBeInTheDocument()
    expect(screen.getByText('Payment date')).toBeInTheDocument()
    expect(screen.queryByText('Start date')).not.toBeInTheDocument()
  })
})

describe('DesktopInsuranceDetail — coverage round-trips through relationship', () => {
  it('preselects the member’s coverage in the edit form and offers Parent/Other', async () => {
    const parentIns = { ...ins, coverageType: 'Parent' } as InsuranceData
    render(<DesktopInsuranceDetail ins={parentIns} locale="en" onClose={vi.fn()} />)

    // Coverage shown on the header (proves it round-trips, not stuck on Self).
    expect(screen.getByText('Parent')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('insurance-edit-btn'))

    // Full option set available, Husband/Wife folded away.
    for (const label of ['Self', 'Spouse', 'Child', 'Parent', 'Other']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Husband' })).not.toBeInTheDocument()

    // The member's current coverage (Parent) is the selected/active option.
    expect(screen.getByRole('button', { name: 'Parent' })).toHaveStyle({ color: 'rgb(255, 255, 255)' })
    expect(screen.getByRole('button', { name: 'Self' })).not.toHaveStyle({ color: 'rgb(255, 255, 255)' })
  })
})

describe('DesktopInsuranceDetail — undo mark-paid', () => {
  afterEach(() => vi.useRealTimers())

  const paidIns: InsuranceData = {
    ...ins,
    status: 'on_track',
    amountSaved: 0,
    savingsProgressPercentage: 0,
    nextPaymentDate: '2027-05-28',
    lastPaymentDate: '2026-05-28',
  } as InsuranceData

  // Render in the settled state deterministically, then hand control back to real
  // timers so waitFor (which polls on a timer) resolves.
  function renderPaid(onChanged = vi.fn()) {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 28))
    const utils = render(<DesktopInsuranceDetail ins={paidIns} locale="en" onClose={vi.fn()} onChanged={onChanged} />)
    vi.useRealTimers()
    return { ...utils, onChanged }
  }

  it('reverts the settlement (POST .../mark-paid/undo) and refreshes', async () => {
    let undoCalled = false
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/mark-paid/undo') && init?.method === 'POST') {
        undoCalled = true
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ entries: [], totalSaved: 0 }) })
    }))
    const { onChanged } = renderPaid()

    fireEvent.click(screen.getByTestId('insurance-undo-mark-paid'))

    await waitFor(() => expect(undoCalled).toBe(true))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('shows an error toast and does not refresh when the undo fails', async () => {
    toastErrorMock.mockClear()
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/mark-paid/undo') && init?.method === 'POST') {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ entries: [], totalSaved: 0 }) })
    }))
    const { onChanged } = renderPaid()

    fireEvent.click(screen.getByTestId('insurance-undo-mark-paid'))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled())
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('offers no undo control when the member is not settled this year', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ entries: [], totalSaved: 0 }) })))
    render(<DesktopInsuranceDetail ins={ins} locale="en" onClose={vi.fn()} />)
    expect(screen.queryByTestId('insurance-undo-mark-paid')).not.toBeInTheDocument()
  })
})

describe('DesktopInsuranceDetail — paid-for-the-year state (issue #227)', () => {
  afterEach(() => vi.useRealTimers())

  // After mark-paid the backend sets last_payment_date to today, advances the
  // due date a year, and resets savings — so status recomputes to on_track.
  const paidIns: InsuranceData = {
    ...ins,
    status: 'on_track',
    amountSaved: 0,
    savingsProgressPercentage: 0,
    nextPaymentDate: '2027-05-28',
    lastPaymentDate: '2026-05-28',
  } as InsuranceData

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 28))
  })

  it('shows a "Paid for <year>" status badge instead of the computed status', () => {
    render(<DesktopInsuranceDetail ins={paidIns} locale="en" onClose={vi.fn()} />)
    expect(screen.getByText('Paid for 2026')).toBeInTheDocument()
    // on_track now renders "Not due"; the paid badge replaces it.
    expect(screen.queryByText('Not due')).not.toBeInTheDocument()
  })

  it('shows the "<year> premium settled" confirmation chip', () => {
    render(<DesktopInsuranceDetail ins={paidIns} locale="en" onClose={vi.fn()} />)
    expect(screen.getByText('2026 premium settled')).toBeInTheDocument()
  })

  it('reframes the savings block as saving for the next year', () => {
    render(<DesktopInsuranceDetail ins={paidIns} locale="en" onClose={vi.fn()} />)
    expect(screen.getByText('Saving for 2027')).toBeInTheDocument()
  })

  it('hides the "Mark as paid" status CTA once paid this year', () => {
    render(<DesktopInsuranceDetail ins={paidIns} locale="en" onClose={vi.fn()} />)
    expect(screen.queryByTestId('insurance-cta-status')).not.toBeInTheDocument()
  })

  it('does NOT show the paid state when the last payment was a previous year', () => {
    const stale: InsuranceData = { ...paidIns, lastPaymentDate: '2025-05-28' } as InsuranceData
    render(<DesktopInsuranceDetail ins={stale} locale="en" onClose={vi.fn()} />)
    expect(screen.queryByText('Paid for 2025')).not.toBeInTheDocument()
    expect(screen.queryByText(/premium settled/)).not.toBeInTheDocument()
  })
})

describe('DesktopInsuranceDetail — settle via the payment modal', () => {
  // The status CTA opens the editable payment modal (like the design). The
  // overdue case must reach a modal that, on confirm, settles via mark-paid.
  it('opens the payment modal in settle mode when the overdue CTA is clicked', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (typeof url === 'string' && url.includes('/savings')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ entries: [], totalSaved: 0 }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const overdue = { ...ins, status: 'overdue' } as InsuranceData

    render(<DesktopInsuranceDetail ins={overdue} locale="en" onClose={vi.fn()} onChanged={vi.fn()} />)

    // Clicking the CTA opens the modal in settle mode (it does NOT settle on its own).
    fireEvent.click(screen.getByTestId('insurance-cta-status'))
    expect(screen.getByTestId('log-payment-modal')).toBeInTheDocument()
    expect(screen.getByText(/transferred the .* premium to the insurer/i)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/mark-paid'),
      expect.anything()
    )
  })

  it('settles via mark-paid when the modal is confirmed', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (typeof url === 'string' && url.includes('/savings')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ entries: [], totalSaved: 0 }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = vi.fn()
    const overdue = { ...ins, status: 'overdue' } as InsuranceData

    render(<DesktopInsuranceDetail ins={overdue} locale="en" onClose={vi.fn()} onChanged={onChanged} />)

    fireEvent.click(screen.getByTestId('insurance-cta-status'))
    // Settle mode has no amount — confirm directly.
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/insurance-members/ins-1/mark-paid'),
        expect.objectContaining({ method: 'POST' })
      )
    )
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })
})
