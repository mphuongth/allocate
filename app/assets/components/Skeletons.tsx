import { Skeleton } from '@/components/ui/Skeleton'
import { SparkDraw } from '@/components/ui/SparkDraw'

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
 * Mobile Overview first-load skeleton — mirrors the design's "Overview — mobile
 * first load" (§02 · Skeleton screens, issue #235): a net-worth card with a
 * drawing-in sparkline and time-range chips, followed by a goals list. Shown on
 * first paint instead of a spinner over an empty card.
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

/**
 * Row-list first-load shimmer — the shared placeholder for the detail panels and
 * sheets that fetch a list on open (transaction history, goal-detail investments
 * / history tabs, insurance payment history, the dashboard's Recent activity).
 * Mirrors a transaction row: leading icon chip, two stacked text lines, a
 * trailing amount. Replaces the legacy "Loading…" text / bare "…" so every
 * first-load speaks the same Cairn vocabulary (issue #235 · §04).
 */
export function TxRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div data-testid="skeleton-tx-rows" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          data-testid="skeleton-tx-row"
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderBottom: i < rows - 1 ? '1px solid var(--c-line)' : 'none' }}
        >
          <Skeleton width={30} height={30} style={{ borderRadius: 8 }} />
          <div style={{ flex: 1, display: 'grid', gap: 6 }}>
            <Skeleton width="44%" height={11} />
            <Skeleton width="26%" height={9} />
          </div>
          <Skeleton width={56} height={12} />
        </div>
      ))}
    </div>
  )
}

/** A single goal-card placeholder in the desktop goals grid. */
function DeskGoalCardSk() {
  return (
    <div data-testid="skeleton-desktop-goal-card" style={{ ...skCard, gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <Skeleton width="60%" height={13} style={{ marginBottom: 7 }} />
          <Skeleton width="38%" height={9} />
        </div>
        <Skeleton width={52} height={18} round />
      </div>
      <Skeleton width="100%" height={6} round />
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Skeleton width={54} height={9} />
        <Skeleton width={40} height={9} />
      </div>
    </div>
  )
}

/**
 * Desktop Overview first-load skeleton — mirrors the design's "Overview —
 * desktop first load" (§02). The desktop Overview is a two-column shell (pinned
 * header + goals grid / recent activity on the left, a 300px net-worth rail on
 * the right), NOT the mobile stack — so it needs its own skeleton.
 */
export function DesktopDashboardSkeleton() {
  return (
    <div
      data-testid="dashboard-skeleton-desktop"
      aria-hidden="true"
      style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--c-canvas)' }}
    >
      {/* Pinned header — eyebrow + greeting on the left, two action buttons on the right */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 28px 16px', borderBottom: '1px solid var(--c-line)', flexShrink: 0 }}>
        <div>
          <Skeleton width={58} height={9} style={{ marginBottom: 8 }} />
          <Skeleton width={190} height={20} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Skeleton width={116} height={34} style={{ borderRadius: 'var(--r-control)' }} />
          <Skeleton width={130} height={34} style={{ borderRadius: 'var(--r-control)' }} />
        </div>
      </header>

      {/* Two-column body */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Left column — goals grid + recent activity */}
        <div style={{ flex: 1, minWidth: 0, padding: '20px 20px 28px 28px', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <Skeleton width={120} height={16} style={{ marginBottom: 6 }} />
              <Skeleton width={78} height={10} />
            </div>
            <Skeleton width={96} height={30} style={{ borderRadius: 'var(--r-control)' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            {[0, 1, 2, 3].map((i) => <DeskGoalCardSk key={i} />)}
          </div>
          <div style={{ marginTop: 24 }}>
            <Skeleton width={110} height={13} style={{ marginBottom: 12 }} />
            <div style={{ ...skCard, gap: 0, padding: 0 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: i < 2 ? '1px solid var(--c-line)' : 'none' }}>
                  <Skeleton width={30} height={30} style={{ borderRadius: 8 }} />
                  <div style={{ flex: 1, display: 'grid', gap: 6 }}>
                    <Skeleton width="40%" height={11} />
                    <Skeleton width="24%" height={9} />
                  </div>
                  <Skeleton width={56} height={12} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right rail — net worth panel (300px, own border) */}
        <div style={{ width: 300, flexShrink: 0, borderLeft: '1px solid var(--c-line)', padding: '20px 20px 28px 16px' }}>
          <div style={skCard}>
            <Skeleton width={70} height={10} />
            <Skeleton width="72%" height={26} />
            <div style={{ display: 'flex', gap: 8 }}>
              <Skeleton width={56} height={16} round />
              <Skeleton width={70} height={14} />
            </div>
            <div style={{ height: 4 }} />
            <SparkDraw color="var(--c-line-strong)" />
            {/* range pills — full-width row */}
            <div style={{ display: 'flex', gap: 4 }}>
              {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} height={22} style={{ flex: 1, borderRadius: 6 }} />)}
            </div>
            {/* KPI 2×2 grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginTop: 4 }}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} style={{ display: 'grid', gap: 6 }}>
                  <Skeleton width="60%" height={9} />
                  <Skeleton width="80%" height={13} />
                </div>
              ))}
            </div>
            {/* allocation bar + breakdown */}
            <Skeleton width="100%" height={8} round style={{ marginTop: 4 }} />
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Skeleton width={8} height={8} round />
                <Skeleton width={60} height={10} />
                <Skeleton width={28} height={10} style={{ marginLeft: 'auto' }} />
                <Skeleton width={44} height={10} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
