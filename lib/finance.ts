export function calcProjectedInterest(
  amount: number,
  rate: number | null,
  investmentDate: string,
  expiryDate?: string | null
): number {
  if (!rate || amount <= 0) return 0
  const endMs = expiryDate
    ? Math.min(Date.now(), new Date(expiryDate).getTime())
    : Date.now()
  const days = Math.max(0, (endMs - new Date(investmentDate).getTime()) / (1000 * 60 * 60 * 24))
  return amount * Math.pow(1 + rate / 100, days / 365) - amount
}

export function isNavStale(updatedAt: string): boolean {
  const diffMs = Date.now() - new Date(updatedAt).getTime()
  return diffMs / (1000 * 60 * 60 * 24) > 1
}

export function insuranceStatus(
  paymentDate: string | null
): 'on_track' | 'upcoming' | 'overdue' | 'completed' {
  if (!paymentDate) return 'on_track'
  const payment = new Date(paymentDate)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const thirtyDaysLater = new Date(today)
  thirtyDaysLater.setDate(today.getDate() + 30)
  if (payment < today) return 'overdue'
  if (payment <= thirtyDaysLater) return 'upcoming'
  return 'on_track'
}
