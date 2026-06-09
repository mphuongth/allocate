/**
 * Decide whether today's net-worth snapshot needs to be written.
 *
 * The dashboard overview is loaded many times a day, but `net_worth_snapshots`
 * holds at most one row per user per day (UNIQUE(user_id, snapshot_date)) and
 * stores `total_assets` as a rounded BIGINT. Re-upserting the same value just
 * rewrites an identical row, which still generates WAL + a dirtied page +
 * autovacuum work — pure disk I/O with no benefit. Only write when the stored
 * value would actually change.
 */
export function shouldWriteSnapshot(
  existing: { total_assets: number } | null | undefined,
  newTotalAssets: number,
): boolean {
  if (!existing) return true
  return Math.round(existing.total_assets) !== Math.round(newTotalAssets)
}
