'use client'

import type { ReactNode } from 'react'
import { useId } from 'react'
import DialogShell from '@/components/ui/DialogShell'
import { ghostBtn, type PlanningVariant } from './planningManagerShell'

// The delete confirmation both planning managers show (#689) — the one overlay
// on this screen where a misfire destroys data.
//
// It was ~62 duplicated lines per manager, differing only in the title, the
// description and the test-id prefix. Keeping one copy is also what makes the
// #688 dialog contract hold for both: focus, Escape, the trap and the semantics
// are inherited from DialogShell here, once, instead of being wired twice and
// remembered twice.
export default function PlanningDeleteConfirm({
  variant,
  testIdPrefix,
  title,
  description,
  extra,
  cancelLabel,
  confirmLabel,
  deleting,
  onCancel,
  onConfirm,
}: {
  variant: PlanningVariant
  /** 'fe' or 'rs' — keeps each feature's existing test ids. */
  testIdPrefix: string
  title: string
  description: ReactNode
  /** Anything a feature must say before destroying the row. Unused today — the
   *  seam exists so sharing the shell never becomes the reason a manager cannot
   *  warn about something specific to it. */
  extra?: ReactNode
  cancelLabel: string
  confirmLabel: string
  deleting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const titleId = useId()

  const body = (
    <>
      <div style={{ fontSize: 13, color: 'var(--c-muted)' }}>{description}</div>
      {extra}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={onCancel} style={ghostBtn}>{cancelLabel}</button>
        <button
          type="button"
          data-testid={`${testIdPrefix}-delete-confirm`}
          onClick={onConfirm}
          disabled={deleting}
          style={{ flex: 2, padding: '10px 0', borderRadius: 10, border: 'none', background: 'var(--c-neg)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: deleting ? 0.7 : 1 }}
        >
          {confirmLabel}
        </button>
      </div>
    </>
  )

  // A delete in flight owns the overlay: a stray click outside must not hide the
  // confirmation while the request is still going.
  const shared = {
    onClose: onCancel,
    dismissOnClickAway: !deleting,
    labelledBy: titleId,
    overlayProps: { 'data-testid': `${testIdPrefix}-delete-overlay` },
  }

  if (variant === 'sheet') {
    // Bottom-anchored so it sits on the phone frame (mirroring the mobile plan's
    // other bottom sheets) instead of floating mid-screen.
    return (
      <DialogShell
        {...shared}
        overlayStyle={{ zIndex: 300, alignItems: 'flex-end' }}
        panelStyle={{ width: '100%', background: 'var(--c-card)', borderRadius: '16px 16px 0 0', paddingBottom: 'env(safe-area-inset-bottom,0)', animation: 'slide-up 220ms cubic-bezier(0.2,0.8,0.2,1)' }}
      >
        <div style={{ width: 36, height: 4, background: 'var(--c-line-strong)', borderRadius: 999, margin: '8px auto 0' }} />
        <div style={{ padding: '14px 16px 0' }}>
          <p id={titleId} style={{ fontWeight: 700, fontSize: 16, color: 'var(--c-ink)', margin: '0 0 16px' }}>{title}</p>
        </div>
        <div style={{ padding: '0 16px 24px', display: 'grid', gap: 16 }}>{body}</div>
      </DialogShell>
    )
  }

  return (
    <DialogShell
      {...shared}
      overlayStyle={{ zIndex: 300, padding: 24 }}
      panelStyle={{ width: 360, maxWidth: '100%', background: 'var(--c-card)', borderRadius: 14, padding: 20, boxShadow: '0 20px 50px rgba(15,23,42,0.25)', display: 'grid', gap: 16 }}
    >
      <div id={titleId} style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-ink)' }}>{title}</div>
      {body}
    </DialogShell>
  )
}
