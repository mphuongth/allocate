import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DesktopInsuranceList from '../DesktopInsuranceList'
import type { InsuranceData } from '../../DashboardClient'

const KEY = 'cairn.insuranceCoachDismissed'

const member: InsuranceData = {
  insuranceId: 'ins-1',
  insuranceName: 'John Doe',
  coverageType: 'Self',
  annualPremium: 12_000_000,
  amountSaved: 6_000_000,
  savingsProgressPercentage: 50,
  status: 'on_track',
  nextPaymentDate: '2026-08-01',
  lastPaymentDate: null,
}

beforeEach(() => localStorage.clear())

describe('DesktopInsuranceList — empty state (desktop design)', () => {
  it('always renders the header with an Add button, even when empty', () => {
    render(<DesktopInsuranceList insurance={[]} goalCount={3} locale="en" onOpen={vi.fn()} onAdd={vi.fn()} />)
    expect(screen.getByTestId('insurance-add-btn')).toBeVisible()
  })

  it('shows the risk-framed coach with the unprotected-goals count when empty', () => {
    render(<DesktopInsuranceList insurance={[]} goalCount={3} locale="en" onOpen={vi.fn()} onAdd={vi.fn()} />)
    expect(screen.getByText('3 goals are unprotected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add member/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /later/i })).toBeInTheDocument()
  })

  it('calls onAdd from the coach "Add member" button', async () => {
    const onAdd = vi.fn()
    render(<DesktopInsuranceList insurance={[]} goalCount={1} locale="en" onOpen={vi.fn()} onAdd={onAdd} />)
    await userEvent.click(screen.getByRole('button', { name: /add member/i }))
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('collapses to a quiet placeholder after "Later" and persists the dismissal', async () => {
    render(<DesktopInsuranceList insurance={[]} goalCount={2} locale="en" onOpen={vi.fn()} onAdd={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /later/i }))
    expect(screen.getByText('No members yet')).toBeInTheDocument()
    expect(screen.queryByText('2 goals are unprotected')).not.toBeInTheDocument()
    expect(localStorage.getItem(KEY)).toBe('1')
  })

  it('renders the quiet placeholder directly when previously dismissed', () => {
    localStorage.setItem(KEY, '1')
    render(<DesktopInsuranceList insurance={[]} goalCount={2} locale="en" onOpen={vi.fn()} onAdd={vi.fn()} />)
    expect(screen.getByText('No members yet')).toBeInTheDocument()
    expect(screen.queryByText(/unprotected/)).not.toBeInTheDocument()
  })

  it('renders member rows and no empty state when members exist', () => {
    render(<DesktopInsuranceList insurance={[member]} goalCount={2} locale="en" onOpen={vi.fn()} onAdd={vi.fn()} />)
    expect(screen.getByTestId('insurance-row')).toBeInTheDocument()
    expect(screen.queryByText(/unprotected/)).not.toBeInTheDocument()
    expect(screen.queryByText('No members yet')).not.toBeInTheDocument()
  })
})

describe('DesktopInsuranceList — paid-for-the-year badge (issue #227)', () => {
  afterEach(() => vi.useRealTimers())
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 28))
  })

  it('shows "Paid for <year>" when the last payment is in the current year', () => {
    const paid = { ...member, lastPaymentDate: '2026-05-28' }
    render(<DesktopInsuranceList insurance={[paid]} goalCount={2} locale="en" onOpen={vi.fn()} onAdd={vi.fn()} />)
    expect(screen.getByText('Paid for 2026')).toBeInTheDocument()
    // member fixture is on_track → "Not due"; the paid badge replaces it.
    expect(screen.queryByText('Not due')).not.toBeInTheDocument()
  })

  it('shows the computed status when not paid this year', () => {
    const stale = { ...member, lastPaymentDate: '2025-05-28' }
    render(<DesktopInsuranceList insurance={[stale]} goalCount={2} locale="en" onOpen={vi.fn()} onAdd={vi.fn()} />)
    expect(screen.getByText('Not due')).toBeInTheDocument()
    expect(screen.queryByText(/Paid for/)).not.toBeInTheDocument()
  })
})

describe('DesktopInsuranceList — status labels', () => {
  // The labels were inverted: `upcoming` (due within 30 days) read "Not due"
  // and `on_track` (31+ days out) read "Due soon". Labels must match meaning.
  it('labels an upcoming (within 30 days) member "Due soon"', () => {
    const m = { ...member, status: 'upcoming' as const }
    render(<DesktopInsuranceList insurance={[m]} goalCount={0} locale="en" onOpen={vi.fn()} onAdd={vi.fn()} />)
    expect(screen.getByTestId('insurance-row')).toHaveTextContent('Due soon')
    expect(screen.queryByText('Not due')).not.toBeInTheDocument()
  })

  it('labels an on_track (far off) member "Not due"', () => {
    const m = { ...member, status: 'on_track' as const }
    render(<DesktopInsuranceList insurance={[m]} goalCount={0} locale="en" onOpen={vi.fn()} onAdd={vi.fn()} />)
    expect(screen.getByTestId('insurance-row')).toHaveTextContent('Not due')
    expect(screen.queryByText('Due soon')).not.toBeInTheDocument()
  })

  // The list said "Ready" while the detail panel and mobile card both say
  // "Ready to pay" (the statusReady i18n string). Keep the label consistent.
  it('labels a ready member "Ready to pay", matching the other views', () => {
    const m = { ...member, status: 'ready' as const }
    render(<DesktopInsuranceList insurance={[m]} goalCount={0} locale="en" onOpen={vi.fn()} onAdd={vi.fn()} />)
    expect(screen.getByTestId('insurance-row')).toHaveTextContent('Ready to pay')
  })
})
