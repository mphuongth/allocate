import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { LandingAppMockup } from '../LandingAppMockup'
import { LandingPlanMockup } from '../LandingPlanMockup'
import viMessages from '../../../messages/vi.json'

// The landing mockups used to be hardcoded English markup ("Overview", "Hi, Minh",
// "Net worth", "Total P/L") drawn against a shell the app never had — a narrow navy
// icon-only rail, where the real app has a light 220px sidebar with text labels. On the
// Vietnamese landing page (the default locale) that rendered a half-English picture of an
// app nobody ships. Both mockups now read their copy from the SAME i18n keys the real
// screens use (nav.*, dashboard.*, planning.*), so they follow the page locale and drift
// with the app instead of away from it.

function renderVi(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages} timeZone="Asia/Ho_Chi_Minh">
      {ui}
    </NextIntlClientProvider>,
  )
}

describe('LandingAppMockup — mirrors the real dashboard shell', () => {
  it('draws the sidebar the app actually has: four labelled nav items', () => {
    renderVi(<LandingAppMockup />)
    // The real Sidebar renders nav.* labels next to icons — not an icon-only rail.
    for (const label of ['Tổng quan', 'Kế hoạch', 'Quỹ', 'Cài đặt']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })

  it('uses the real Overview copy, in the page locale', () => {
    renderVi(<LandingAppMockup />)
    expect(screen.getByText('Xin chào, Minh')).toBeInTheDocument()
    expect(screen.getByText('Tài sản Ròng')).toBeInTheDocument()
    // The 2×2 KPI grid the real DesktopNetWorthPanel renders.
    for (const kpi of ['Đã đầu tư', 'Giá trị hiện tại', 'Tổng tài sản', 'Nợ']) {
      expect(screen.getByText(kpi)).toBeInTheDocument()
    }
  })

  it('leaks no hardcoded English into the Vietnamese page', () => {
    renderVi(<LandingAppMockup />)
    for (const stale of ['Overview', 'Hi, Minh', 'Net worth', 'Total P/L', 'Goals']) {
      expect(screen.queryByText(stale)).not.toBeInTheDocument()
    }
  })

  it('shows the real production URL, not a domain we do not own', () => {
    renderVi(<LandingAppMockup />)
    expect(screen.queryByText('cairn.app/dashboard')).not.toBeInTheDocument()
    expect(screen.getByText('cairn-money.vercel.app/dashboard')).toBeInTheDocument()
  })
})

describe('LandingPlanMockup — mirrors the real Monthly plan screen', () => {
  it('uses the real planning copy, in the page locale', () => {
    renderVi(<LandingPlanMockup />)
    expect(screen.getByText('Kế hoạch Tháng')).toBeInTheDocument()
    expect(screen.getByText('Tổng Phân bổ')).toBeInTheDocument()
    expect(screen.getByText('Lương Còn lại')).toBeInTheDocument()
  })

  it('leaks no hardcoded English into the Vietnamese page', () => {
    renderVi(<LandingPlanMockup />)
    for (const stale of ['Monthly plan', 'Invest this month', 'Remaining', 'Contribution by goal']) {
      expect(screen.queryByText(stale)).not.toBeInTheDocument()
    }
  })
})
