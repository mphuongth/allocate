import { CairnLoader } from './CairnLoader'

interface FullPageLoaderProps {
  /** Primary caption, e.g. "Loading your portfolio". Also the loader's a11y label. */
  title: string
  /** Optional secondary caption, e.g. "Syncing latest balances…". */
  subtitle?: string
}

/**
 * Full-screen branded loading state — a large Cairn loader with a caption.
 * Used for the first app load ("page-level" indicator in the design); the
 * caller decides where to mount it. See issue #235.
 */
export function FullPageLoader({ title, subtitle }: FullPageLoaderProps) {
  return (
    <div
      className="full-page-loader"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 28,
      }}
    >
      <CairnLoader size={56} label={title} />
      <div style={{ marginTop: 22, fontSize: 14, fontWeight: 600, color: 'var(--c-ink)' }}>{title}</div>
      {subtitle && (
        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--c-muted)' }}>{subtitle}</div>
      )}
    </div>
  )
}

export default FullPageLoader
