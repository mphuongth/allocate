import { DashboardSkeleton, DesktopDashboardSkeleton } from '@/app/assets/components/Skeletons'

/**
 * Route-level Suspense fallback for /dashboard. The App Router paints this the
 * instant the tab is tapped — before the async page component resolves its
 * `getUser()` auth round-trip — so switching tabs feels immediate instead of
 * dead for ~1s. It reuses the exact skeletons + breakpoint toggle DashboardClient
 * renders for its own first-load, so the hand-off to the client component is
 * seamless (no flash). See loading design §04. Fixes the slow tab-switch report.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-4 md:space-y-0 md:flex md:flex-col md:flex-1 md:min-h-0">
      <div className="md:hidden">
        <DashboardSkeleton />
      </div>
      <div className="hidden md:block md:flex-1 md:min-h-0">
        <DesktopDashboardSkeleton />
      </div>
    </div>
  )
}
