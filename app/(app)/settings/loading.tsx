import { Skeleton } from '@/components/ui/Skeleton'

const card: React.CSSProperties = {
  background: 'var(--c-card)',
  border: '1px solid var(--c-line)',
  borderRadius: 'var(--r-card)',
}

/** Profile card placeholder — avatar + name/email lines. */
function ProfileSk() {
  return (
    <div style={{ ...card, padding: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
      <Skeleton width={48} height={48} round />
      <div style={{ flex: 1, display: 'grid', gap: 8 }}>
        <Skeleton width="45%" height={15} />
        <Skeleton width="60%" height={11} />
      </div>
    </div>
  )
}

/** A settings section card — heading + a few preference rows. */
function SectionSk({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ ...card, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--c-line)' }}>
        <Skeleton width={110} height={13} />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: i < rows - 1 ? '1px solid var(--c-line)' : 'none' }}
        >
          <Skeleton width="40%" height={12} />
          <Skeleton width={44} height={20} round />
        </div>
      ))}
    </div>
  )
}

/**
 * Route-level Suspense fallback for /settings. Settings renders synchronously
 * from server props (no client data fetch), so the only tab-switch delay is the
 * server `getUser()` round-trip — this skeleton fills exactly that gap with a
 * profile card + preference sections instead of a dead tap. Mobile and desktop
 * both get a variant. See loading design §04.
 */
export default function SettingsLoading() {
  return (
    <>
      {/* Mobile */}
      <div className="md:hidden" data-testid="settings-loading-skeleton-mobile" style={{ padding: '4px 16px 100px', display: 'grid', gap: 12 }} aria-hidden="true">
        <ProfileSk />
        <SectionSk rows={3} />
        <SectionSk rows={2} />
      </div>

      {/* Desktop */}
      <div className="hidden md:block" data-testid="settings-loading-skeleton-desktop" aria-hidden="true">
        <div style={{ padding: '20px 28px 40px', maxWidth: 720, display: 'grid', gap: 16 }}>
          <Skeleton width={140} height={20} />
          <ProfileSk />
          <SectionSk rows={3} />
          <SectionSk rows={2} />
        </div>
      </div>
    </>
  )
}
