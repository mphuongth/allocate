import { useState, useEffect, useRef } from 'react'

// The transaction shape both goal-detail surfaces render. Superset of what each
// used locally (the mobile sheet also reads fund_code / unit_price); the desktop
// panel simply ignores the extra fields.
export interface InvestmentTx {
  transaction_id: string
  transaction_type: string
  asset_type: string
  fund_id: string | null
  fund_name: string | null
  fund_code?: string | null
  parent_transaction_id: string | null
  investment_date: string
  amount_vnd: number
  units: number | null
  unit_price?: number | null
  interest_rate: number | null
  expiry_date: string | null
  notes: string | null
  principal_withdrawn: number | null
  units_withdrawn: number | null
  renewed_from_transaction_id?: string | null
  interest_earned_vnd?: number | null
  is_recurring?: boolean
  held_for_merge?: boolean | null
  consumed_by_inv_id?: string | null
  top_up_lock_days?: number | null
  successor_deposit_tx_id?: string | null
  // Set on every row of an accumulating book; equals transaction_id on the
  // anchor, which is the row that carries the book's terms.
  deposit_group_id?: string | null
}

export interface UseGoalDetailData {
  transactions: InvestmentTx[]
  txLoading: boolean
  txError: boolean
  goldPricePerChi: number | null
}

// The goal-detail transactions + gold-price load, shared by GoalDetailSheet
// (mobile) and DesktopGoalDetail so the two can't drift (#467). The effect was
// previously copy-pasted verbatim into both.
//
// `enabled` gates the load (the mobile sheet only loads while open; the desktop
// panel is always mounted). `onLoadStart` fires at the start of every load so
// the caller can reset its own optimistic state (e.g. the unassigned-id filter).
export function useGoalDetailData(opts: {
  goalId: string | undefined
  enabled: boolean
  refreshKey: unknown
  txReload: unknown
  onLoadStart?: () => void
}): UseGoalDetailData {
  const { goalId, enabled, refreshKey, txReload } = opts
  const [transactions, setTransactions] = useState<InvestmentTx[]>([])
  const [goldPricePerChi, setGoldPricePerChi] = useState<number | null>(null)
  const [txLoading, setTxLoading] = useState(false)
  const [txError, setTxError] = useState(false)

  // Keep the latest onLoadStart without making it a load dependency (callers
  // pass an inline arrow, so it changes identity every render).
  const onLoadStartRef = useRef(opts.onLoadStart)
  useEffect(() => { onLoadStartRef.current = opts.onLoadStart })

  // A fetch keyed on goalId/refreshKey: the flags mark a request that is about
  // to be issued, not state derived from props, so there is nothing to move to
  // render time. Clearing the error alongside is what keeps a retry from showing
  // the previous failure while the new attempt is in flight.
  useEffect(() => {
    if (!enabled || !goalId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data load; see above
    setTxLoading(true)
    setTxError(false)
    // The new server response is the source of truth — let the caller drop any
    // locally hidden tx IDs from the unassign flow so a re-assigned tx isn't
    // stuck behind the optimistic filter on subsequent refreshes.
    onLoadStartRef.current?.()
    // cache: 'no-store' — without it the browser can serve a stale list when an
    // investment was just (re)assigned to this goal in the same session.
    // Recurring savings are plan-only (no investment_transactions row), so fetch
    // their realized contributions separately and merge into the history list.
    Promise.all([
      // The investments list is built from these rows — a failed fetch must
      // surface a retry, not render as "No investments yet".
      fetch(`/api/v1/investment-transactions?goal_id=${goalId}&limit=200&include_history=true`, { cache: 'no-store' })
        .then((r) => { if (!r.ok) throw new Error('load failed'); return r.json() }),
      // Recurring contributions are supplementary — degrade to empty on failure.
      fetch(`/api/v1/savings-goals/${goalId}/recurring-contributions`, { cache: 'no-store' })
        .then((r) => r.ok ? r.json() : { contributions: [] })
        .catch(() => ({ contributions: [] })),
    ])
      .then(async ([txRes, recRes]) => {
        const rows: InvestmentTx[] = txRes.transactions ?? []
        // A book's terms — maturity, bank, lock window, whether it has handed
        // over to a successor — live on its ANCHOR, and this page holds only the
        // newest 200 rows. An old book with recent tranches would otherwise be
        // read off a tranche, which knows none of that, and would look like it
        // still takes top-ups (#638). Ask for the few anchors that fell out.
        const present = new Set(rows.map((r) => r.transaction_id))
        const missingAnchors = [...new Set(
          rows.map((r) => r.deposit_group_id).filter((id): id is string => !!id && !present.has(id)),
        )]
        // Batched, because a goal holding many older books would otherwise open
        // one connection per anchor before the page could render — and chunked
        // rather than capped, so no book is quietly left reading a tranche.
        const CHUNK = 100
        const chunks: string[][] = []
        for (let i = 0; i < missingAnchors.length; i += CHUNK) chunks.push(missingAnchors.slice(i, i + CHUNK))
        // A failed anchor batch fails the load. These are not supplementary like
        // the recurring contributions: without an anchor a book renders off a
        // tranche, which does not know the book has handed over — so it would
        // offer actions the database then refuses. A retry beats a wrong page.
        const anchors: InvestmentTx[] = (await Promise.all(chunks.map((chunk) =>
          fetch(`/api/v1/investment-transactions?ids=${chunk.join(',')}&include_history=true&limit=${CHUNK}`, { cache: 'no-store' })
            .then((r) => { if (!r.ok) throw new Error('anchor load failed'); return r.json() })
            .then((res) => (res?.transactions ?? []) as InvestmentTx[]),
        ))).flat()

        const merged: InvestmentTx[] = [...rows, ...anchors, ...(recRes.contributions ?? [])]
        merged.sort((a, b) => (a.investment_date < b.investment_date ? 1 : a.investment_date > b.investment_date ? -1 : 0))
        setTransactions(merged)
      })
      .catch(() => { setTransactions([]); setTxError(true) })
      .finally(() => setTxLoading(false))
    // Gold is valued at the live market price per chỉ, not its purchase cost —
    // without this the sell UI would prefill the stale buy price (issue #251).
    fetch('/api/v1/gold-price', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((res) => setGoldPricePerChi(res?.price_per_chi ?? null))
      .catch(() => setGoldPricePerChi(null))
  }, [enabled, goalId, refreshKey, txReload])

  return { transactions, txLoading, txError, goldPricePerChi }
}
