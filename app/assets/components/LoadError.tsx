'use client'

import { RefreshCw } from 'lucide-react'
import PendingButton from '@/components/ui/PendingButton'
import { useSessionExpired } from '@/lib/sessionExpiry'

/**
 * Inline "couldn't load — try again" state for sheets/panels that fetch their
 * own data. Use this instead of falling back to an empty list on a failed
 * fetch, so a transient network error never reads as "you have no data".
 * The retry button re-runs the loader.
 *
 * Renders nothing once the session has ended: a 401 is not a load that failed,
 * retrying it can only 401 again, and the session-ended dialog is already
 * saying what actually happened (#719).
 *
 * `isVI` is passed explicitly (not read via useLocale) so this works in the
 * desktop panels that thread locale through props and render without an intl
 * provider.
 */
export default function LoadError({
  isVI,
  onRetry,
  retrying,
  compact,
}: {
  isVI: boolean
  onRetry: () => void
  retrying?: boolean
  compact?: boolean
}) {
  const sessionExpired = useSessionExpired()
  if (sessionExpired) return null

  return (
    <div
      data-testid="load-error"
      role="alert"
      style={{
        display: 'grid', gap: 10, justifyItems: 'center', textAlign: 'center',
        padding: compact ? '16px 0' : '24px 0',
      }}
    >
      <p style={{ margin: 0, fontSize: 13, color: 'var(--c-muted)', lineHeight: 1.5 }}>
        {isVI ? 'Không tải được dữ liệu' : "Couldn't load data"}
      </p>
      {/* The cairn loader rather than a spinning RefreshCw: one loading
          vocabulary across the app (#235), and this was the last holdout
          animating its own icon. */}
      <PendingButton
        data-testid="load-error-retry"
        pending={!!retrying}
        pendingLabel={isVI ? 'Đang tải…' : 'Loading…'}
        icon={<RefreshCw size={13} strokeWidth={2.2} />}
        loaderVariant="muted"
        loaderSize={12}
        onClick={onRetry}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '7px 14px', borderRadius: 8,
          border: '1px solid var(--c-line)', background: 'var(--c-card)',
          color: 'var(--c-ink)', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
          cursor: retrying ? 'default' : 'pointer',
        }}
      >
        {isVI ? 'Thử lại' : 'Try again'}
      </PendingButton>
    </div>
  )
}
