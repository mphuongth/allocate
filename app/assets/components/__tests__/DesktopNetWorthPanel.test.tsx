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

  // English copy parity with the mobile NetWorthCard (which reads en.json). The
  // desktop panel hardcodes its KPI labels and had drifted from the mobile ones:
  // "Current" vs "Current value", "Total assets" vs "Total Assets".
  it('uses the canonical English KPI labels (matches the mobile card)', () => {
    renderPanel({ locale: 'en' })
    expect(screen.getByText('Current value')).toBeInTheDocument()
    expect(screen.getByText('Total Assets')).toBeInTheDocument()
  })

  // Desktop/mobile copy parity: the panel hardcodes its Vietnamese labels while
  // the mobile NetWorthCard pulls the same strings from messages/vi.json. They
  // used to drift ("tổng" vs "tổng thể"). Pin the desktop side to the canonical
  // wording so the two viewports read identically.
  it('uses the canonical Vietnamese labels (matches the mobile card)', () => {
    renderPanel({ locale: 'vi' })
    // overall-P&L suffix — must be "tổng thể", not the old "tổng"
    expect(screen.getByText('tổng thể')).toBeInTheDocument()
    // total-assets KPI label — correct Vietnamese casing
    expect(screen.getByText('Tổng tài sản')).toBeInTheDocument()
  })
})
