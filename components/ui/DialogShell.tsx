'use client'

import { useRef, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { useDialogA11y } from './useDialogA11y'

// The dialog contract as a component, not as a checklist (#688).
//
// useDialogA11y has been shared since #600, but every asset and planning overlay
// still hand-rolled its own fixed <div>: a few called the hook, most did not, and
// almost none set role/aria-modal/an accessible name. The behaviour a keyboard or
// screen-reader user gets was decided per file, by whoever wrote it — which is
// how a contract quietly stops being one.
//
// So the overlay itself is the contract now. A sheet supplies content and its own
// styling; it cannot opt out of Escape, focus entry, focus restore, the Tab trap
// or the semantics by forgetting a line.

const OVERLAY: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15,23,42,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

export default function DialogShell({
  onClose,
  label,
  labelledBy,
  dismissOnClickAway = true,
  overlayStyle,
  panelStyle,
  panelProps,
  panelRef,
  overlayProps,
  children,
}: {
  onClose: () => void
  /** An accessible name, when no visible element carries it. */
  label?: string
  /** id of the visible title naming this dialog. Preferred over `label`. */
  labelledBy?: string
  /** False while a save is in flight, so a stray click cannot discard the form. */
  dismissOnClickAway?: boolean
  overlayStyle?: CSSProperties
  panelStyle?: CSSProperties
  panelProps?: Record<string, unknown>
  /** For a sheet that measures or scrolls its own panel. */
  panelRef?: RefObject<HTMLDivElement | null>
  overlayProps?: Record<string, unknown>
  children: ReactNode
}) {
  const ownRef = useRef<HTMLDivElement>(null)
  const ref = panelRef ?? ownRef

  // Always active: the wrapper only renders while its sheet is open, so mounting
  // IS opening. A sheet that keeps itself mounted while closed renders nothing.
  useDialogA11y(ref, true, onClose)

  return (
    <div
      data-testid="dialog-overlay"
      onClick={() => dismissOnClickAway && onClose()}
      style={{ ...OVERLAY, ...overlayStyle }}
      {...overlayProps}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        // The panel swallows its own clicks so the overlay's dismissal only ever
        // means "outside".
        onClick={(e) => e.stopPropagation()}
        style={panelStyle}
        {...panelProps}
      >
        {children}
      </div>
    </div>
  )
}
