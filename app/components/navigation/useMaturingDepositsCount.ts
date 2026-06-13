'use client'

import { useEffect, useState } from 'react'
import { isActionableTermDeposit } from '@/lib/maturity'
import type { DashboardData } from '@/app/assets/DashboardClient'

// Count of bank term deposits that currently need a renew/withdraw decision —
// drives the nav badge so the user sees it from any page. Fetches the dashboard
// overview once on mount (the same endpoint the dashboard uses, served from the
// SW/HTTP cache when warm). Fails silent → 0, so the badge simply hides on error
// rather than blocking navigation. Uses the same isActionableTermDeposit filter
// as the dashboard "Needs attention" card, so the two never disagree.
export function useMaturingDepositsCount(): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/dashboard/overview', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: DashboardData | null) => {
        if (cancelled || !data) return
        const items = [
          ...data.goals.flatMap((g) => g.nonFunds ?? []),
          ...data.unallocated.nonFunds,
        ]
        setCount(items.filter(isActionableTermDeposit).length)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  return count
}
