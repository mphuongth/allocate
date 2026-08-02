// Maps a Net-worth history range token (sent by the Overview range pills) to the
// inclusive lower-bound date (YYYY-MM-DD) used to filter snapshots. Returns null
// for "all" / unknown, meaning no lower bound.
//
// Measured back from the *business* day, because that is what the snapshots are
// keyed to (see lib/dates). Subtracting from the UTC date parts moved the cutoff
// a day earlier for the first seven hours of each Vietnam day, so the chart
// gained a snapshot before 07:00 and lost it again afterwards — inside a single
// business day (#591). Month steps clamp to the last valid day, so a cutoff
// measured from the 31st can't overflow into the next month and silently drop a
// month of history.
import { todayIso, addMonths } from './dates'

const RANGE_MONTHS: Record<string, number> = {
  '1m': 1,
  '3m': 3,
  '6m': 6,
  '1y': 12,
  '3y': 36,
}

export function rangeStartDate(range: string, now: Date = new Date()): string | null {
  const months = RANGE_MONTHS[range]
  if (!months) return null // 'all' or anything unrecognised
  return addMonths(todayIso(now), -months)
}
