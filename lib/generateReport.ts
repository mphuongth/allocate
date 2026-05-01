import type { DashboardData } from '@/app/assets/DashboardClient'

export async function downloadPortfolioPDF(data: DashboardData, locale: string): Promise<void> {
  const res = await fetch('/api/v1/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, locale }),
  })

  if (!res.ok) throw new Error('Failed to generate report')

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `allocate-report-${new Date().toISOString().slice(0, 10)}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}
