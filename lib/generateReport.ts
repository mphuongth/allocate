import { todayIso } from '@/lib/dates'

/**
 * Ask the server for the portfolio PDF and save it.
 *
 * Only the locale is sent. The endpoint derives every figure from the caller's
 * own holdings, so there is nothing here to keep in sync with the dashboard —
 * and no way for a client to put invented numbers, or a payload of its own
 * choosing in size, into a report (#594).
 */
export async function downloadPortfolioPDF(locale: string): Promise<void> {
  const res = await fetch('/api/v1/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locale }),
  })

  if (!res.ok) throw new Error('Failed to generate report')

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `allocate-report-${todayIso()}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}
