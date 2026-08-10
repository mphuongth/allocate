import { daysUntilIso } from './dates'

export type AccumulatingTopUpEligibility =
  | { status: 'allowed' }
  | { status: 'locked-near-maturity'; daysRemaining: number; lockDays: number }
  | { status: 'matured'; daysRemaining: number }

// Classify whether a new tranche may join an accumulating book on the entered
// business date. A null lock preserves legacy behavior: such books accept
// top-ups until (but not including) their maturity date.
export function classifyAccumulatingTopUp({
  topUpDate,
  expiryDate,
  lockDays,
}: {
  topUpDate: string
  expiryDate: string | null
  lockDays: number | null
}): AccumulatingTopUpEligibility {
  if (!expiryDate) return { status: 'allowed' }

  const daysRemaining = daysUntilIso(expiryDate, topUpDate)
  if (daysRemaining <= 0) return { status: 'matured', daysRemaining }
  if (lockDays != null && daysRemaining <= lockDays) {
    return { status: 'locked-near-maturity', daysRemaining, lockDays }
  }
  return { status: 'allowed' }
}
