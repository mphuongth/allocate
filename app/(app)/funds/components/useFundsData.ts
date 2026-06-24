'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

// ─── Shared types ─────────────────────────────────────────────────────────────

export type FundType = 'balanced' | 'equity' | 'debt' | 'gold'

export type Fund = {
  id: string
  name: string
  code: string
  fund_type: FundType
  nav: number
  nav_source_url: string | null
  is_dca: boolean
  dca_monthly_amount_vnd: number | null
  dca_goal_id: string | null
  created_at: string
  updated_at: string
}

export type Goal = { goal_id: string; goal_name: string }

export interface FundsData {
  funds: Fund[]
  setFunds: Dispatch<SetStateAction<Fund[]>>
  goals: Goal[]
  loading: boolean
  error: boolean
  /** Bust the cache and refetch funds from the server. */
  reload: () => Promise<void>
}

// ─── Cache ──────────────────────────────────────────────────────────────────

const CACHE_KEY = 'fundLibraryCache'
const CACHE_TTL = 2 * 60 * 1000

function getCache(): Fund[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    if (Date.now() - ts > CACHE_TTL) return null
    return data
  } catch { return null }
}
function setCache(data: Fund[]) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() })) } catch {}
}
function bustCache() {
  try { localStorage.removeItem(CACHE_KEY) } catch {}
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

// Single owner of the Fund Library's data layer. Both MobileFundLibraryView and
// DesktopFundLibraryView are always mounted (FundLibraryClient renders both,
// toggled by CSS). Owning funds + savings-goals here means one fetch on mount
// and one reload per mutation instead of two of each — and the two views now
// read the same shared state, so the old cross-view 'cairn:funds-updated' event
// (and its _suppressNotify guard) is no longer needed (#10).
export function useFundsData(): FundsData {
  const [funds, setFunds] = useState<Fund[]>(() => getCache() ?? [])
  const [loading, setLoading] = useState(() => !getCache())
  const [error, setError] = useState(false)
  const [goals, setGoals] = useState<Goal[]>([])

  const reload = useCallback(async () => {
    bustCache()
    setError(false)
    try {
      const res = await fetch('/api/funds')
      if (!res.ok) throw new Error()
      const { funds: data } = await res.json()
      setCache(data)
      setFunds(data)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  // Savings goals for the DCA target dropdown — loaded once.
  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/savings-goals')
      .then((res) => res.ok ? res.json() : { goals: [] })
      .then(({ goals: data }) => { if (!cancelled) setGoals(data ?? []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  return { funds, setFunds, goals, loading, error, reload }
}
