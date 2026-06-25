'use client'

import { usePathname } from 'next/navigation'
import { Plus } from 'lucide-react'
import { useMaturingDepositsCount } from './useMaturingDepositsCount'

// Where the mobile "add transaction" FAB is contextual. It only belongs on
// Overview and Funds — on Plan you add via the plan's own rows, and Settings has
// nothing to add. On Overview it additionally yields while term deposits need a
// maturity decision, so the floating button can never sit on top of the
// "Cần xử lý" card's action button.
export function shouldShowMobileFab(pathname: string, maturingCount: number): boolean {
  const onOverview = pathname.startsWith('/dashboard')
  const onFunds = pathname.startsWith('/funds')
  return (onOverview && maturingCount === 0) || onFunds
}

export default function MobileAddTransactionFab({ onClick }: { onClick: () => void }) {
  const pathname = usePathname()
  const maturingCount = useMaturingDepositsCount()

  if (!shouldShowMobileFab(pathname, maturingCount)) return null

  // The button's inline `display: flex` would override a `md:hidden` class
  // (inline > class specificity), so the wrapper handles md+ hiding.
  return (
    <div className="md:hidden">
      <button
        onClick={onClick}
        aria-label="Add transaction"
        style={{
          position: 'fixed', right: 16, bottom: 80,
          width: 52, height: 52, borderRadius: 26,
          background: 'var(--c-btn-primary)', color: '#fff',
          border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 6px 16px rgba(15, 42, 74, 0.25), 0 2px 4px rgba(15, 42, 74, 0.1)',
          cursor: 'pointer', zIndex: 35,
        }}
      >
        <Plus size={22} strokeWidth={2.2} />
      </button>
    </div>
  )
}
