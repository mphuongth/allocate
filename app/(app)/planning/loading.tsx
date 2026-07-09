import { MobilePlanningSkeleton, DesktopPlanningSkeleton } from './components/PlanningSkeleton'

/**
 * Route-level Suspense fallback for /planning. Paints instantly on tab tap and
 * mirrors the mobile stack / desktop tables that PlanningClient shows on its own
 * first load, so the client component takes over without a flash. The wrappers
 * match each view's outer padding/background (MobilePlanningView `md:hidden`
 * canvas stack; DesktopPlanningView scroll padding). See loading design §04.
 */
export default function PlanningLoading() {
  return (
    <>
      <div className="md:hidden" style={{ background: 'var(--c-canvas)', minHeight: '100%' }}>
        <div style={{ padding: '4px 16px 100px', display: 'grid', gap: 10 }}>
          <MobilePlanningSkeleton />
        </div>
      </div>
      <div className="hidden md:block" style={{ padding: '20px 24px 40px' }}>
        <DesktopPlanningSkeleton />
      </div>
    </>
  )
}
