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

// ─── Format picker ─────────────────────────────────────────────────────────────

describe('DownloadReportSheet — format picker', () => {
  it('renders Format label', () => {
    render(<DownloadReportSheet open data={null} onClose={noop} onExport={noop} />)
    expect(screen.getByText(/^format$/i)).toBeInTheDocument()
  })

  it('renders PDF and CSV buttons', () => {
    render(<DownloadReportSheet open data={null} onClose={noop} onExport={noop} />)
    expect(screen.getByRole('button', { name: /^pdf$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^csv$/i })).toBeInTheDocument()
  })

  it('PDF is selected by default', () => {
    render(<DownloadReportSheet open data={null} onClose={noop} onExport={noop} />)
    const pdfBtn = screen.getByRole('button', { name: /^pdf$/i })
    expect(pdfBtn).toHaveAttribute('aria-pressed', 'true')
  })

  it('selecting CSV updates selection', async () => {
    render(<DownloadReportSheet open data={null} onClose={noop} onExport={noop} />)
    await userEvent.click(screen.getByRole('button', { name: /^csv$/i }))
    expect(screen.getByRole('button', { name: /^csv$/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^pdf$/i })).toHaveAttribute('aria-pressed', 'false')
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

  it('renders Cancel button', () => {
    render(<DownloadReportSheet open data={null} onClose={noop} onExport={noop} />)
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument()
  })

  it('export button shows selected format', () => {
    render(<DownloadReportSheet open data={null} onClose={noop} onExport={noop} />)
    expect(screen.getByRole('button', { name: /export report · pdf/i })).toBeInTheDocument()
  })

  it('export button updates format label when CSV is selected', async () => {
    render(<DownloadReportSheet open data={null} onClose={noop} onExport={noop} />)
    await userEvent.click(screen.getByRole('button', { name: /^csv$/i }))
    expect(screen.getByRole('button', { name: /export report · csv/i })).toBeInTheDocument()
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
