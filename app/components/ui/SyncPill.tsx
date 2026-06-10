import { CairnLoader } from './CairnLoader'

interface SyncPillProps {
  /** Label, e.g. "Syncing fund prices…". */
  label: string
  /** When false, render nothing. */
  show: boolean
}

/**
 * Background-sync pill — a floating, non-blocking banner near the top of the
 * screen with an XS Cairn, shown while a background refresh runs (loading
 * design §03 · "Background sync", issue #235).
 */
export function SyncPill({ label, show }: SyncPillProps) {
  if (!show) return null
  return (
    <div className="sync-bar sync-bar-float" role="status" aria-live="polite">
      {/* Loader is decorative here — the pill itself is the live region. */}
      <span aria-hidden="true" style={{ display: 'inline-flex' }}>
        <CairnLoader size={14} />
      </span>
      {label}
    </div>
  )
}

export default SyncPill
