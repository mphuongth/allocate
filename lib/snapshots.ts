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

/**
 * How long the dashboard response is willing to wait for the snapshot write.
 * History is a nice-to-have next to the numbers on screen, so a slow database
 * costs us one history point, never a slow (or failed) dashboard.
 */
export const SNAPSHOT_WRITE_TIMEOUT_MS = 2_000

export type SnapshotWriteResult = { ok: true } | { ok: false; reason: string }

/**
 * Run the snapshot upsert to completion so a serverless instance cannot freeze
 * mid-write (#592): the old fire-and-forget `.then()` let the response return
 * first, dropping history points with no trace. Every failure mode — a Supabase
 * error, a rejection, or a write that never settles — is reported back to the
 * caller instead of thrown, so the dashboard response is never at risk.
 */
export async function persistSnapshot(
  write: () => PromiseLike<{ error: { message?: string } | null }>,
  { timeoutMs = SNAPSHOT_WRITE_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<SnapshotWriteResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs)
    })
    const outcome = await Promise.race([Promise.resolve(write()), timeout])
    if (outcome === 'timeout') return { ok: false, reason: 'timeout' }
    if (outcome?.error) return { ok: false, reason: outcome.error.message ?? 'unknown error' }
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  } finally {
    // Leave no pending timer behind — it would keep the function instance awake.
    clearTimeout(timer)
  }
}
