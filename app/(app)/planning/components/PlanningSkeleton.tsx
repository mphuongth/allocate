import { Skeleton } from '@/app/components/ui/Skeleton'

const card: React.CSSProperties = {
  background: 'var(--c-card)',
  border: '1px solid var(--c-line)',
  borderRadius: 16,
  boxShadow: 'var(--shadow-card)',
}

/**
 * Desktop planning first-load skeleton — mirrors the desktop plan layout (4-cell
 * summary strip + allocation-section tables) so first paint shows structure,
 * not a spinner over an empty card (loading design §04 · "Screen first paint";
 * each breakpoint gets its own skeleton). Issue #235.
 */
export function DesktopPlanningSkeleton() {
  return (
    <div data-testid="planning-skeleton" aria-hidden="true">
      {/* Summary strip — Income / Outflow / Remaining / Saved % */}
      <div
        data-testid="planning-skeleton-summary"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: 'var(--c-line)', borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}
      >
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ background: 'var(--c-card)', padding: '14px 18px' }}>
            <Skeleton width={56} height={10} />
            <Skeleton width={72} height={18} style={{ marginTop: 8 }} />
          </div>
        ))}
      </div>

      {/* Allocation sections — header + a few line rows each */}
      {[0, 1, 2].map((s) => (
        <div key={s} data-testid="planning-skeleton-section" className="cn-card" style={{ overflow: 'hidden', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--c-line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Skeleton width={24} height={24} style={{ borderRadius: 6 }} />
              <Skeleton width={120} height={14} />
            </div>
            <Skeleton width={70} height={14} />
          </div>
          {[0, 1, 2].map((r) => (
            <div
              key={r}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: r < 2 ? '1px solid var(--c-line)' : 'none' }}
            >
              <Skeleton width="45%" height={12} />
              <Skeleton width={64} height={12} />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * Mobile planning first-load skeleton — mirrors the mobile plan stack (salary
 * card + 3-cell summary strip + stacked allocation sections), distinct from the
 * desktop two-table layout. Issue #235.
 */
export function MobilePlanningSkeleton() {
  return (
    <div data-testid="mobile-planning-skeleton" aria-hidden="true" style={{ display: 'grid', gap: 10 }}>
      {/* Salary card */}
      <div style={{ ...card, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <Skeleton width={64} height={10} style={{ marginBottom: 8 }} />
          <Skeleton width={120} height={22} />
        </div>
        <Skeleton width={28} height={28} style={{ borderRadius: 8 }} />
      </div>

      {/* Summary strip — Outflow / Remaining / Saved % */}
      <div
        data-testid="mobile-planning-skeleton-summary"
        style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, overflow: 'hidden', background: 'var(--c-line)' }}
      >
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ background: 'var(--c-card)', padding: '10px 12px' }}>
            <Skeleton width={44} height={9} />
            <Skeleton width={56} height={14} style={{ marginTop: 6 }} />
          </div>
        ))}
      </div>

      {/* Allocation sections */}
      {[0, 1].map((s) => (
        <div key={s} data-testid="mobile-planning-skeleton-section" style={{ ...card, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid var(--c-line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Skeleton width={22} height={22} style={{ borderRadius: 6 }} />
              <Skeleton width={100} height={13} />
            </div>
            <Skeleton width={60} height={13} />
          </div>
          {[0, 1].map((r) => (
            <div
              key={r}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderBottom: r < 1 ? '1px solid var(--c-line)' : 'none' }}
            >
              <Skeleton width="50%" height={12} />
              <Skeleton width={56} height={12} />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
