import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import DownloadReportSheet from '../DownloadReportSheet'

// The rest of this sheet localizes its visible text via `isVI`, but the control
// aria-labels (close X, Cancel, Exporting) were hardcoded English — so a
// Vietnamese screen-reader user heard "close" / "cancel" instead of the visible
// "Đóng" / "Hủy". Render in Vietnamese and assert the control names are localized.
vi.mock('next-intl', () => ({
  useLocale: () => 'vi',
}))

const noop = () => Promise.resolve()

describe('DownloadReportSheet — Vietnamese control aria-labels', () => {
  it('localizes the close button (mobile variant) to "Đóng"', () => {
    render(<DownloadReportSheet open data={null} onClose={noop} onExport={noop} />)
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument()
  })

  it('localizes the close button (desktop variant) to "Đóng"', () => {
    render(<DownloadReportSheet open desktop data={null} onClose={noop} onExport={noop} />)
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument()
  })

  it('gives the Cancel button the localized name "Hủy" (no hardcoded "cancel" override)', () => {
    render(<DownloadReportSheet open data={null} onClose={noop} onExport={noop} />)
    expect(screen.getByRole('button', { name: 'Hủy' })).toBeInTheDocument()
  })
})
