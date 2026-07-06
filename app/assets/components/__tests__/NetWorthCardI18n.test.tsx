import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import NetWorthCard from '../NetWorthCard'
import viMessages from '../../../../messages/vi.json'

// Unlike NetWorthCard.test.tsx (which mocks next-intl to an identity function),
// this suite wires the REAL Vietnamese messages so the actual rendered copy is
// asserted — the layer where the desktop/mobile drift lived. The mobile card
// reads its labels from messages/vi.json; pin the canonical wording here.

global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })

const baseProps = {
  totalAssets: 500_000_000,
  totalLiabilities: 0,
  netWorth: 500_000_000,
  totalInvested: 400_000_000,
  currentValue: 450_000_000,
  overallProfitLoss: 100_000_000,
  overallProfitLossPercentage: 25,
}

function renderVi() {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages} timeZone="Asia/Ho_Chi_Minh">
      <NetWorthCard {...baseProps} />
    </NextIntlClientProvider>,
  )
}

describe('NetWorthCard — Vietnamese copy', () => {
  it('renders the total-assets label with correct casing', () => {
    renderVi()
    expect(screen.getByText('Tổng tài sản')).toBeInTheDocument()
    // The old mis-cased value must be gone.
    expect(screen.queryByText('Tổng Tài sản')).not.toBeInTheDocument()
  })

  it('renders the overall-P&L suffix as "tổng thể"', () => {
    renderVi()
    expect(screen.getByText('tổng thể')).toBeInTheDocument()
  })
})
