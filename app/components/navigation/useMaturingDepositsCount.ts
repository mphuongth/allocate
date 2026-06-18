'use client'

import { useEffect, useRef, useState } from 'react'
import { isActionableTermDeposit, MATURING_COUNT_EVENT } from '@/lib/maturity'
import { actionableBookRows } from '@/app/assets/maturityCardItems'
import type { DashboardData } from '@/app/assets/DashboardClient'

// Count of bank term deposits that currently need a renew/withdraw decision —
// drives the nav badge so the user sees it from any page. Two sources, no
// disagreement: the dashboard's live event is authoritative when mounted, and a
// one-time overview fetch is the fallback for pages where the dashboard isn't
// mounted. Both use the same isActionableTermDeposit filter as the card. Fails
// silent → 0 so the badge simply hides on error.
export function useMaturingDepositsCount(): number {
  const [count, setCount] = useState<number | null>(null)
  // Once a live dashboard event arrives it is the source of truth; don't let a
  // slower fallback fetch overwrite it with a staler number.
  const liveRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    const onLiveCount = (e: Event) => {
      liveRef.current = true
      setCount((e as CustomEvent<number>).detail)
    }
    window.addEventListener(MATURING_COUNT_EVENT, onLiveCount)

    fetch('/api/v1/dashboard/overview', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: DashboardData | null) => {
        if (cancelled || liveRef.current || !data) return
        const items = [
          ...data.goals.flatMap((g) => g.nonFunds ?? []),
          ...data.unallocated.nonFunds,
        ]
        // Same tally as the dashboard: term deposits one each + each accumulating
        // book counted ONCE (grouped). isVi doesn't affect the count.
        setCount(items.filter(isActionableTermDeposit).length + actionableBookRows(items, false).length)
      })
      .catch(() => {})

    return () => {
      cancelled = true
      window.removeEventListener(MATURING_COUNT_EVENT, onLiveCount)
    }
  }, [])

  return count ?? 0
}
