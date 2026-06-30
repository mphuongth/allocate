import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DesktopNetWorthPanel from '../DesktopNetWorthPanel'
import type { DashboardData } from '../../DashboardClient'
import type { AllocationTotals } from '../../overviewData'

// DesktopNetWorthPanel takes data/allocationTotals/locale as props (no next-intl),
// so it renders in isolation. These cover the desktop-overview E2E presence checks
// (net-worth label, allocation bar, download-report button) that don't need a browser.

const data = {
  netWorth: {
    netWorth: 100_000_000,
    overallProfitLoss: 5_000_000,
    overallProfitLossPercentage: 5,
    totalInvested: 95_000_000,
    currentValue: 100_000_000,
    totalAssets: 100_000_000,
    totalLiabilities: 0,
  },
} as unknown as DashboardData

const allocationTotals = {
  fundTotal: 60_000_000,
  bankTotal: 40_000_000,
  goldTotal: 0,
  stockTotal: 0,
} as unknown as AllocationTotals

function renderPanel(over: Partial<React.ComponentProps<typeof DesktopNetWorthPanel>> = {}) {
  return render(
    <DesktopNetWorthPanel
      data={data}
      allocationTotals={allocationTotals}
      locale="en"
      onDownloadReport={vi.fn()}
      {...over}
    />,
  )
}

describe('DesktopNetWorthPanel', () => {
  it('renders the Net worth label', () => {
    renderPanel()
    expect(screen.getByText('Net worth')).toBeInTheDocument()
  })

  it('renders the allocation bar when there are positive allocation totals', () => {
    renderPanel()
    expect(screen.getByTestId('allocation-bar')).toBeInTheDocument()
  })

  it('omits the allocation bar when every allocation total is zero', () => {
    renderPanel({ allocationTotals: { fundTotal: 0, bankTotal: 0, goldTotal: 0, stockTotal: 0 } as unknown as AllocationTotals })
    expect(screen.queryByTestId('allocation-bar')).not.toBeInTheDocument()
  })

  it('renders the download report button and fires onDownloadReport when clicked', () => {
    const onDownloadReport = vi.fn()
    renderPanel({ onDownloadReport })
    const btn = screen.getByTestId('generate-report-btn')
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onDownloadReport).toHaveBeenCalled()
  })
})
