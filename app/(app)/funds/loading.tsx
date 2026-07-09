import { Skeleton } from '@/app/components/ui/Skeleton'

const card: React.CSSProperties = {
  background: 'var(--c-card)',
  border: '1px solid var(--c-line)',
  borderRadius: 16,
}

/**
 * Route-level Suspense fallback for /funds. Paints instantly on tab tap, then
 * hands off to each view's own `funds-loading-skeleton` once useFundsData
 * resolves — so a fund-row shimmer is on screen the whole time instead of a
 * dead tap. Each breakpoint gets its own shape (mobile card stack vs desktop
 * single-card row list), mirroring the Mobile/DesktopFundLibraryView skeletons.
 */
export default function FundsLoading() {
  return (
    <>
      {/* Mobile — stacked fund cards */}
      <div className="md:hidden" data-testid="funds-loading-skeleton-mobile" style={{ display: 'grid', gap: 8 }} aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ ...card, padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
            <Skeleton width={36} height={36} style={{ borderRadius: 8 }} />
            <div style={{ flex: 1, display: 'grid', gap: 6 }}>
              <Skeleton width="55%" height={13} />
              <Skeleton width="75%" height={10} />
            </div>
            <Skeleton width={56} height={13} />
          </div>
        ))}
      </div>

      {/* Desktop — single card, row list */}
      <div className="hidden md:block" data-testid="funds-loading-skeleton-desktop" aria-hidden="true">
        <div style={{ ...card, overflow: 'hidden' }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: i < 4 ? '1px solid var(--c-line)' : 'none' }}
            >
              <Skeleton width={32} height={32} style={{ borderRadius: 8, flexShrink: 0 }} />
              <div style={{ flex: 1, display: 'grid', gap: 6 }}>
                <Skeleton width="35%" height={13} />
                <Skeleton width="22%" height={10} />
              </div>
              <Skeleton width={72} height={13} />
              <Skeleton width={56} height={13} />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
