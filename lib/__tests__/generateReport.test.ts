import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { DashboardData } from '@/app/assets/DashboardClient'

const mockData: DashboardData = {
  netWorth: {
    totalAssets: 500_000_000,
    totalLiabilities: 0,
    netWorth: 500_000_000,
    totalInvested: 400_000_000,
    currentValue: 500_000_000,
    overallProfitLoss: 100_000_000,
    overallProfitLossPercentage: 25,
    navStale: false,
    hasGold: false,
  },
  goals: [
    {
      goalId: 'g1',
      goalName: 'Mua nhà',
      targetAmount: 1_000_000_000,
      currentValue: 300_000_000,
      totalInvested: 250_000_000,
      profitLoss: 50_000_000,
      profitLossPercentage: 20,
      progressPercentage: 30,
      funds: [],
    },
  ],
  unallocated: { totalValue: 0, funds: [], nonFunds: [] },
  byType: { bank: 100_000_000, gold: 0, stock: 0 },
  insurance: [],
}

const mockPdfBlob = new Blob(['%PDF-1.4'], { type: 'application/pdf' })

describe('downloadPortfolioPDF', () => {
  let anchorClickMock: ReturnType<typeof vi.fn>
  let anchorElement: Partial<HTMLAnchorElement>

  beforeEach(() => {
    anchorClickMock = vi.fn()
    anchorElement = { click: anchorClickMock as unknown as () => void, href: '', download: '' }

    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url') as unknown as typeof URL.createObjectURL
    global.URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') return anchorElement as HTMLAnchorElement
      return document.createElement(tag)
    })

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(mockPdfBlob),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs to /api/v1/report with data and locale as JSON', async () => {
    const { downloadPortfolioPDF } = await import('../generateReport')
    await downloadPortfolioPDF(mockData, 'vi')
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/report', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: mockData, locale: 'vi' }),
    }))
  })

  it('triggers a download by clicking the anchor element', async () => {
    const { downloadPortfolioPDF } = await import('../generateReport')
    await downloadPortfolioPDF(mockData, 'en')
    expect(anchorClickMock).toHaveBeenCalled()
  })

  it('sets filename with today\'s date in YYYY-MM-DD format', async () => {
    const { downloadPortfolioPDF } = await import('../generateReport')
    await downloadPortfolioPDF(mockData, 'vi')
    expect(anchorElement.download).toMatch(/^allocate-report-\d{4}-\d{2}-\d{2}\.pdf$/)
  })

  it('uses a blob URL as the anchor href', async () => {
    const { downloadPortfolioPDF } = await import('../generateReport')
    await downloadPortfolioPDF(mockData, 'vi')
    expect(URL.createObjectURL).toHaveBeenCalledWith(mockPdfBlob)
    expect(anchorElement.href).toBe('blob:mock-url')
  })

  it('revokes the object URL after download', async () => {
    const { downloadPortfolioPDF } = await import('../generateReport')
    await downloadPortfolioPDF(mockData, 'vi')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })

  it('throws when the API returns a non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, blob: vi.fn() })
    const { downloadPortfolioPDF } = await import('../generateReport')
    await expect(downloadPortfolioPDF(mockData, 'en')).rejects.toThrow('Failed to generate report')
  })
})
