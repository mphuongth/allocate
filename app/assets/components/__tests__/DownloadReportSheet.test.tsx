import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DownloadReportSheet from '../DownloadReportSheet'

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
}))

const sampleData = {
  netWorth: 100_000_000,
  currentValue: 95_000_000,
  totalPL: 5_000_000,
  goalCount: 3,
}

const noop = () => Promise.resolve()

// ─── Structure ─────────────────────────────────────────────────────────────────

describe('DownloadReportSheet — structure', () => {
  it('renders portfolio report title', () => {
    render(<DownloadReportSheet open data={sampleData} onClose={noop} onExport={noop} />)
    expect(screen.getByText(/portfolio report/i)).toBeInTheDocument()
  })

  it('renders date line', () => {
    render(<DownloadReportSheet open data={sampleData} onClose={noop} onExport={noop} />)
    expect(screen.getByText(/as of/i)).toBeInTheDocument()
  })

  it('renders KPI grid when data is provided', () => {
    render(<DownloadReportSheet open data={sampleData} onClose={noop} onExport={noop} />)
    expect(screen.getByText('Net worth')).toBeInTheDocument()
    expect(screen.getByText('Current value')).toBeInTheDocument()
    expect(screen.getByText(/total p\/l/i)).toBeInTheDocument()
    expect(screen.getByText(/goals tracked/i)).toBeInTheDocument()
  })

  it('hides KPI grid when data is null', () => {
    render(<DownloadReportSheet open data={null} onClose={noop} onExport={noop} />)
    expect(screen.queryByText('Current value')).not.toBeInTheDocument()
  })

  it('renders "Report includes" section with uppercase heading', () => {
    render(<DownloadReportSheet open data={null} onClose={noop} onExport={noop} />)
    expect(screen.getByText(/report includes/i)).toBeInTheDocument()
  })

  it('renders all checklist items', () => {
    render(<DownloadReportSheet open data={null} onClose={noop} onExport={noop} />)
    expect(screen.getByText(/net worth overview/i)).toBeInTheDocument()
    expect(screen.getByText(/per-goal breakdown/i)).toBeInTheDocument()
    expect(screen.getByText(/unallocated holdings/i)).toBeInTheDocument()
    expect(screen.getByText(/transaction history/i)).toBeInTheDocument()
  })
})

// ─── Format ──────────────────────────────────────────────────────────────────────
// The CSV option was a dead control (export always produced a PDF), so it was
// removed — exports are PDF-only until a real CSV path exists.

describe('DownloadReportSheet — format', () => {
  it('does not render a CSV format option', () => {
    render(<DownloadReportSheet open data={null} onClose={noop} onExport={noop} />)
    expect(screen.queryByRole('button', { name: /^csv$/i })).not.toBeInTheDocument()
  })

  it('does not render a PDF/CSV picker toggle', () => {
    render(<DownloadReportSheet open data={null} onClose={noop} onExport={noop} />)
    // No format-picker buttons (aria-pressed toggles) remain.
    expect(screen.queryByRole('button', { name: /^pdf$/i })).not.toBeInTheDocument()
  })
})

// ─── Actions ───────────────────────────────────────────────────────────────────

describe('DownloadReportSheet — actions', () => {
  it('renders X close button in header', () => {
    render(<DownloadReportSheet open data={null} onClose={noop} onExport={noop} />)
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
  })

  it('calls onClose when X close button is clicked', async () => {
    const onClose = vi.fn()
    render(<DownloadReportSheet open data={null} onClose={onClose} onExport={noop} />)
    await userEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('labels the close button "Close" consistently on both the desktop and mobile variants', () => {
    // Regression: desktop used aria-label="Close" but mobile used "close".
    const { unmount } = render(<DownloadReportSheet open desktop data={null} onClose={noop} onExport={noop} />)
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    unmount()
    render(<DownloadReportSheet open data={null} onClose={noop} onExport={noop} />)
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('renders Cancel button', () => {
    render(<DownloadReportSheet open data={null} onClose={noop} onExport={noop} />)
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument()
  })

  it('export button reads "Export report" without a format suffix', () => {
    render(<DownloadReportSheet open data={null} onClose={noop} onExport={noop} />)
    const btn = screen.getByRole('button', { name: /export report/i })
    expect(btn).toBeInTheDocument()
    expect(btn.getAttribute('aria-label')).not.toMatch(/·/)
  })

  it('calls onClose when Cancel is clicked', async () => {
    const onClose = vi.fn()
    render(<DownloadReportSheet open data={null} onClose={onClose} onExport={noop} />)
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onExport when Export report is clicked', async () => {
    const onExport = vi.fn().mockResolvedValue(undefined)
    render(<DownloadReportSheet open data={null} onClose={noop} onExport={onExport} />)
    await userEvent.click(screen.getByRole('button', { name: /export report/i }))
    await waitFor(() => expect(onExport).toHaveBeenCalled())
  })

  it('disables Export button while exporting', async () => {
    let resolve!: () => void
    const onExport = vi.fn().mockImplementation(
      () => new Promise<void>(res => { resolve = res })
    )
    render(<DownloadReportSheet open data={null} onClose={noop} onExport={onExport} />)
    await userEvent.click(screen.getByRole('button', { name: /export report/i }))
    expect(screen.getByRole('button', { name: /exporting/i })).toBeDisabled()
    resolve()
  })

  it('surfaces an error and re-enables the button when export fails', async () => {
    const onExport = vi.fn().mockRejectedValue(new Error('boom'))
    render(<DownloadReportSheet open data={null} onClose={noop} onExport={onExport} />)
    await userEvent.click(screen.getByRole('button', { name: /export report/i }))
    await waitFor(() => expect(screen.getByText(/couldn’t export|could not export|failed/i)).toBeInTheDocument())
    // Not stuck in the exporting state.
    expect(screen.getByRole('button', { name: /export report/i })).not.toBeDisabled()
  })
})

// ─── Success state ─────────────────────────────────────────────────────────────

describe('DownloadReportSheet — success state', () => {
  it('shows success title after export', async () => {
    const onExport = vi.fn().mockResolvedValue(undefined)
    render(<DownloadReportSheet open data={null} onClose={noop} onExport={onExport} />)
    await userEvent.click(screen.getByRole('button', { name: /export report/i }))
    await waitFor(() => expect(screen.getByText(/report exported/i)).toBeInTheDocument())
  })

  it('shows download folder subtitle after export', async () => {
    const onExport = vi.fn().mockResolvedValue(undefined)
    render(<DownloadReportSheet open data={null} onClose={noop} onExport={onExport} />)
    await userEvent.click(screen.getByRole('button', { name: /export report/i }))
    await waitFor(() => expect(screen.getByText(/downloads folder/i)).toBeInTheDocument())
  })
})
