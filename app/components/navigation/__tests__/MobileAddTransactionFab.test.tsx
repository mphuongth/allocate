import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { usePathname } from 'next/navigation'
import MobileAddTransactionFab, { shouldShowMobileFab } from '../MobileAddTransactionFab'
import { useMaturingDepositsCount } from '../useMaturingDepositsCount'

vi.mock('next/navigation', () => ({ usePathname: vi.fn() }))
vi.mock('../useMaturingDepositsCount', () => ({ useMaturingDepositsCount: vi.fn() }))

const mockPathname = vi.mocked(usePathname)
const mockCount = vi.mocked(useMaturingDepositsCount)

function fab() {
  return screen.queryByRole('button', { name: 'Add transaction' })
}

beforeEach(() => {
  mockPathname.mockReturnValue('/dashboard')
  mockCount.mockReturnValue(0)
})

describe('MobileAddTransactionFab — where it renders', () => {
  it('shows on Overview when no maturities need a decision', () => {
    mockPathname.mockReturnValue('/dashboard')
    mockCount.mockReturnValue(0)
    render(<MobileAddTransactionFab onClick={() => {}} />)
    expect(fab()).toBeInTheDocument()
  })

  it('hides on Overview while term deposits need a maturity decision (so it cannot cover the action card)', () => {
    mockPathname.mockReturnValue('/dashboard')
    mockCount.mockReturnValue(2)
    render(<MobileAddTransactionFab onClick={() => {}} />)
    expect(fab()).not.toBeInTheDocument()
  })

  it('shows on Funds', () => {
    mockPathname.mockReturnValue('/funds')
    render(<MobileAddTransactionFab onClick={() => {}} />)
    expect(fab()).toBeInTheDocument()
  })

  it('shows on Funds even when maturities are pending (Funds is not gated by maturity)', () => {
    mockPathname.mockReturnValue('/funds')
    mockCount.mockReturnValue(3)
    render(<MobileAddTransactionFab onClick={() => {}} />)
    expect(fab()).toBeInTheDocument()
  })

  it('shows on a Funds sub-route', () => {
    mockPathname.mockReturnValue('/funds/abc-123')
    render(<MobileAddTransactionFab onClick={() => {}} />)
    expect(fab()).toBeInTheDocument()
  })

  it('hides on Plan (it has its own add affordances)', () => {
    mockPathname.mockReturnValue('/planning')
    render(<MobileAddTransactionFab onClick={() => {}} />)
    expect(fab()).not.toBeInTheDocument()
  })

  it('hides on Settings (no add action there)', () => {
    mockPathname.mockReturnValue('/settings')
    render(<MobileAddTransactionFab onClick={() => {}} />)
    expect(fab()).not.toBeInTheDocument()
  })

  it('calls onClick when tapped', () => {
    const onClick = vi.fn()
    mockPathname.mockReturnValue('/dashboard')
    render(<MobileAddTransactionFab onClick={onClick} />)
    fireEvent.click(fab()!)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('shouldShowMobileFab — rule', () => {
  it('Overview: shown only with zero maturing deposits', () => {
    expect(shouldShowMobileFab('/dashboard', 0)).toBe(true)
    expect(shouldShowMobileFab('/dashboard', 1)).toBe(false)
  })

  it('Funds: always shown regardless of maturities', () => {
    expect(shouldShowMobileFab('/funds', 0)).toBe(true)
    expect(shouldShowMobileFab('/funds', 5)).toBe(true)
  })

  it('Plan and Settings: never shown', () => {
    expect(shouldShowMobileFab('/planning', 0)).toBe(false)
    expect(shouldShowMobileFab('/settings', 0)).toBe(false)
  })
})
