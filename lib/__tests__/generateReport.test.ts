import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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

  // The body carries the locale and nothing else: the endpoint derives every
  // figure from the caller's own holdings, so posting the dashboard payload back
  // to it was both forgeable and unbounded in size (#594).
  it('POSTs to /api/v1/report with only the locale as JSON', async () => {
    const { downloadPortfolioPDF } = await import('../generateReport')
    await downloadPortfolioPDF('vi')
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/report', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: 'vi' }),
    }))
  })

  it('triggers a download by clicking the anchor element', async () => {
    const { downloadPortfolioPDF } = await import('../generateReport')
    await downloadPortfolioPDF('en')
    expect(anchorClickMock).toHaveBeenCalled()
  })

  it('sets filename with today\'s date in YYYY-MM-DD format', async () => {
    const { downloadPortfolioPDF } = await import('../generateReport')
    await downloadPortfolioPDF('vi')
    expect(anchorElement.download).toMatch(/^allocate-report-\d{4}-\d{2}-\d{2}\.pdf$/)
  })

  it('uses a blob URL as the anchor href', async () => {
    const { downloadPortfolioPDF } = await import('../generateReport')
    await downloadPortfolioPDF('vi')
    expect(URL.createObjectURL).toHaveBeenCalledWith(mockPdfBlob)
    expect(anchorElement.href).toBe('blob:mock-url')
  })

  it('revokes the object URL after download', async () => {
    const { downloadPortfolioPDF } = await import('../generateReport')
    await downloadPortfolioPDF('vi')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })

  it('throws when the API returns a non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, blob: vi.fn() })
    const { downloadPortfolioPDF } = await import('../generateReport')
    await expect(downloadPortfolioPDF('en')).rejects.toThrow('Failed to generate report')
  })
})
