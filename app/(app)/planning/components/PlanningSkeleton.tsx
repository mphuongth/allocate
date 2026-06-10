import { Skeleton } from '@/app/components/ui/Skeleton'

/**
 * Planning first-load skeleton — mirrors the plan layout (4-cell summary strip
 * + allocation-section cards) so first paint shows structure, not a spinner
 * over an empty card (loading design §04 · "Screen first paint", issue #235).
 */
export function PlanningSkeleton() {
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
