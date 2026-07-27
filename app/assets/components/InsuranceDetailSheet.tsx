'use client'

import { useEffect } from 'react'
import type { InsuranceData } from '../DashboardClient'
import DesktopInsuranceDetail from './DesktopInsuranceDetail'
import { useDialogMount } from '@/app/(app)/planning/components/useDialogMount'

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

  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!mounted || !ins) return null

  return (
    <div
      data-testid="insurance-detail-sheet"
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
