import { Skeleton } from '@/app/components/ui/Skeleton'
import { SparkDraw } from '@/app/components/ui/SparkDraw'

/** Card chrome matching the real dashboard cards (GoalCard / NetWorthCard). */
const skCard: React.CSSProperties = {
  background: 'var(--c-card)',
  border: '1px solid var(--c-line)',
  borderRadius: 'var(--r-card)',
  boxShadow: 'var(--shadow-card)',
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

/**
 * Dashboard first-load skeleton — mirrors the design's "Dashboard — first load"
 * (§02 · Skeleton screens, issue #235): a net-worth card with a drawing-in
 * sparkline and time-range chips, followed by a goals list. Shown on first
 * paint instead of a spinner over an empty card.
 */
export function DashboardSkeleton() {
  return (
    <div
      data-testid="dashboard-skeleton"
      aria-hidden="true"
      style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 880, margin: '0 auto' }}
    >
      {/* Net worth card */}
      <div style={skCard}>
        <Skeleton width={70} height={10} />
        <Skeleton width="60%" height={28} />
        <div style={{ display: 'flex', gap: 10 }}>
          <Skeleton width={64} height={16} round />
          <Skeleton width={90} height={16} />
        </div>
        <div style={{ height: 6 }} />
        <SparkDraw color="var(--c-line-strong)" />
        <div data-testid="skeleton-range-chips" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          {['1M', '3M', '6M', '1Y', 'All'].map((l) => (
            <Skeleton key={l} width={24} height={10} />
          ))}
        </div>
      </div>

      {/* Goals list */}
      <div>
        <Skeleton width={80} height={14} className="mb-3" />
        {[0, 1].map((i) => (
          <div key={i} data-testid="skeleton-goal-card" style={{ ...skCard, marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div style={{ flex: 1 }}>
                <Skeleton width="55%" height={14} className="mb-1.5" />
                <Skeleton width="35%" height={10} />
              </div>
              <Skeleton width={70} height={18} />
            </div>
            <Skeleton width="100%" height={6} round />
          </div>
        ))}
      </div>
    </div>
  )
}
