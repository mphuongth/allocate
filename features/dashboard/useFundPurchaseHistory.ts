'use client'

import { useCallback, useState } from 'react'

/** One purchase of a fund, as the detail modal lists it. */
interface PurchaseHistoryItem {
  purchase_date: string
  units: number
  nav_at_purchase: number
}

interface FundInvestmentRow {
  nav_at_purchase: number
  units_purchased: number
  investment_date: string | null
  created_at: string
}

export interface FundPurchaseHistory {
  /** The fund whose detail modal is open, or null when it is closed. */
  fundId: string | null
  items: PurchaseHistoryItem[]
  loading: boolean
  /** The request failed — distinct from a fund that genuinely has no purchases. */
  failed: boolean
  open: (fundId: string) => Promise<void>
  close: () => void
}

/**
 * The fund-detail modal's purchase history (#602).
 *
 * Lifted out of DashboardClient, where opening a fund set four pieces of state
 * by hand. `failed` is deliberately separate from an empty `items`: both render
 * no rows, but only one of them should tell the user the load broke.
 */
export function useFundPurchaseHistory(): FundPurchaseHistory {
  const [fundId, setFundId] = useState<string | null>(null)
  const [items, setItems] = useState<PurchaseHistoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const open = useCallback(async (id: string) => {
    setFundId(id)
    // Clear first: otherwise the modal shows the previous fund's purchases
    // under the new fund's name while the request is in flight.
    setItems([])
    setFailed(false)
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/fund-investments?fund_id=${id}`)
      if (!res.ok) throw new Error('load failed')
      const rows = (await res.json()) as FundInvestmentRow[]
      setItems(
        rows
          .map((r) => ({
            purchase_date: r.investment_date ?? r.created_at,
            units: r.units_purchased,
            nav_at_purchase: r.nav_at_purchase,
          }))
          .sort((a, b) => new Date(b.purchase_date).getTime() - new Date(a.purchase_date).getTime()),
      )
    } catch {
      setFailed(true)
    }
    setLoading(false)
  }, [])

  const close = useCallback(() => setFundId(null), [])

  return { fundId, items, loading, failed, open, close }
}
