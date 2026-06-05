// Maps a Net-worth history range token (sent by the Overview range pills) to the
// inclusive lower-bound date (YYYY-MM-DD) used to filter snapshots. Returns null
// for "all" / unknown, meaning no lower bound.
//
// UTC methods keep the cutoff deterministic regardless of server timezone — the
// result is compared against date-only strings (snapshot_date / YYYY-MM).
export function rangeStartDate(range: string, now: Date = new Date()): string | null {
  const d = new Date(now)
  switch (range) {
    case '1m': d.setUTCMonth(d.getUTCMonth() - 1); break
    case '3m': d.setUTCMonth(d.getUTCMonth() - 3); break
    case '6m': d.setUTCMonth(d.getUTCMonth() - 6); break
    case '1y': d.setUTCFullYear(d.getUTCFullYear() - 1); break
    case '3y': d.setUTCFullYear(d.getUTCFullYear() - 3); break
    default: return null // 'all' or anything unrecognised
  }
  return d.toISOString().split('T')[0]
}
