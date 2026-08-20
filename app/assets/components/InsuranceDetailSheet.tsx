'use client'

import { useEffect, useRef } from 'react'
import type { InsuranceData } from '@/features/dashboard/contracts'
import DesktopInsuranceDetail from './DesktopInsuranceDetail'
import { useDialogMount } from '@/components/ui/useDialogMount'
import { useDialogA11y } from '@/components/ui/useDialogA11y'

interface Props {
  ins: InsuranceData | null
  open: boolean
  locale: string
  onClose: () => void
  onChanged?: () => void
}

/**
 * Mobile full-screen detail view for an insurance member. Reuses the
 * self-contained DesktopInsuranceDetail panel (edit / pay / history / delete)
 * inside a slide-in overlay so tapping an insurance row on mobile opens its
 * details instead of doing nothing.
 */
export default function InsuranceDetailSheet({ ins, open, locale, onClose, onChanged }: Props) {
  // 200ms here, not the 220 default — this sheet's exit animation is shorter.
  const mounted = useDialogMount(open, 200)

  // The dialog contract, applied directly rather than through DialogShell: this
  // sheet IS the fixed element — full-screen, its own scroll container, no scrim
  // and so no click-away — and wrapping it in the shell's overlay would put a
  // second scrolling box around the one the animation and overscroll rules are
  // written for. What it owes a keyboard user is the same either way (#688).
  const panelRef = useRef<HTMLDivElement>(null)
  useDialogA11y(panelRef, open && mounted, onClose)

  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!mounted || !ins) return null

  return (
    <div
      ref={panelRef}
      data-testid="insurance-detail-sheet"
      role="dialog"
      aria-modal="true"
      // Named by the policy it is showing: "dialog" alone tells a screen-reader
      // user nothing about which member they just opened.
      aria-label={ins.insuranceName}
      style={{
        position: 'fixed', inset: 0, zIndex: 120,
        background: 'var(--c-canvas, #faf9f7)',
        overflowY: 'auto', overflowX: 'hidden',
        overscrollBehavior: 'contain',
        animation: open
          ? 'pop-in 220ms cubic-bezier(0.2, 0.8, 0.2, 1)'
          : 'fade-out 180ms ease forwards',
      }}
    >
      <div style={{ padding: '16px 16px 40px' }}>
        <DesktopInsuranceDetail
          ins={ins}
          locale={locale}
          onClose={onClose}
          onChanged={onChanged}
        />
      </div>
    </div>
  )
}
