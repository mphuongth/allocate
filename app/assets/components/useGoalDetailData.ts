import { useState, useEffect, useRef } from 'react'

// The transaction shape both goal-detail surfaces render. Superset of what each
// used locally (the mobile sheet also reads fund_code / unit_price); the desktop
// panel simply ignores the extra fields.
interface InvestmentTx {
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
  // On the tranche a completed merge credited: the book its cash came from.
  merged_from_book_id?: string | null
  // Set on every row of an accumulating book; equals transaction_id on the
  // anchor, which is the row that carries the book's terms.
  deposit_group_id?: string | null
  // The name of the row parent_transaction_id points at — the deposit a
  // withdrawal drew from. Attached by the API for withdrawal rows (#713); the
  // history render passes it straight into describeHistoryRow.
  parentNotes?: string | null
}

export interface UseGoalDetailData {
  transactions: InvestmentTx[]
  // Deposits this page must be able to NAME but must not treat as holdings —
  // a merged source, a successor that fell off the page. Keyed by id (#638).
  bookNames: Record<string, string>
  txLoading: boolean
  txError: boolean
  goldPricePerChi: number | null
  // The user's inflation assumption, or null when they have never set one — the
  // caller resolves that against a per-goal override and the app default (see
  // lib/inflation resolveInflationRate). Null is "not chosen", never 0.
  userInflationRatePct: number | null
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
  const [bookNames, setBookNames] = useState<Record<string, string>>({})
  const [goldPricePerChi, setGoldPricePerChi] = useState<number | null>(null)
  const [userInflationRatePct, setUserInflationRatePct] = useState<number | null>(null)
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
        // Books this page only has to NAME, which is a different thing from a
        // book it has to read. A merged source is dissolved, so nothing points
        // at it through deposit_group_id any more — only merged_from_book_id, on
        // the tranche it paid for — and on a goal past the page it fell out and
        // the "Merged from …" line silently vanished (#638 Phase 4).
        //
        // Fetched apart from the anchors above and kept OUT of `transactions`.
        // That source is a closed row whose own closing withdrawal may sit
        // outside the page too; handed to the holdings build it reads as a live
        // deposit at full value, and the goal counts that money twice — here and
        // in the book it was folded into.
        const nameOnly = [...new Set(
          rows.flatMap((r) => [r.merged_from_book_id, r.successor_deposit_tx_id])
            .filter((id): id is string => !!id && !present.has(id) && !missingAnchors.includes(id)),
        )]
        // Batched, because a goal holding many older books would otherwise open
        // one connection per anchor before the page could render — and chunked
        // rather than capped, so no book is quietly left reading a tranche.
        const CHUNK = 100
        // A failed batch fails the load. These are not supplementary like the
        // recurring contributions: without an anchor a book renders off a
        // tranche, which does not know the book has handed over — so it would
        // offer actions the database then refuses. A retry beats a wrong page.
        const fetchByIds = async (ids: string[]): Promise<InvestmentTx[]> => {
          const chunks: string[][] = []
          for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK))
          return (await Promise.all(chunks.map((chunk) =>
            fetch(`/api/v1/investment-transactions?ids=${chunk.join(',')}&include_history=true&limit=${CHUNK}`, { cache: 'no-store' })
              .then((r) => { if (!r.ok) throw new Error('anchor load failed'); return r.json() })
              .then((res) => (res?.transactions ?? []) as InvestmentTx[]),
          ))).flat()
        }

        // One round for both, so a page needing an anchor and a name does not
        // open two sets of connections; the results part ways after.
        const anchors = await fetchByIds([...missingAnchors, ...nameOnly])

        // A promise is recorded on the ANCHOR, so a book whose anchor fell off
        // the page only reveals its successor once that anchor is back. One
        // more round for those, and only when there are any: computing this
        // from the first page alone left the promise reading as the anonymous
        // "successor book" on exactly the goals big enough to need the backfill.
        const known = new Set([...present, ...anchors.map((a) => a.transaction_id)])
        const secondPass = [...new Set(
          anchors.flatMap((a) => [a.merged_from_book_id, a.successor_deposit_tx_id])
            .filter((id): id is string => !!id && !known.has(id)),
        )]
        const namedOnly = secondPass.length > 0 ? await fetchByIds(secondPass) : []

        // Every one of these was fetched to be named, not to be held.
        const nameOnlySet = new Set([...nameOnly, ...secondPass])
        const names: Record<string, string> = {}
        for (const a of [...anchors, ...namedOnly]) {
          const n = a.notes?.trim()
          if (n) names[a.transaction_id] = n
        }
        setBookNames(names)

        const merged: InvestmentTx[] = [
          ...rows,
          ...anchors.filter((a) => !nameOnlySet.has(a.transaction_id)),
          ...(recRes.contributions ?? []),
        ]
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
    // The inflation assumption is commentary on the goal, not part of its
    // valuation, so a failed read degrades to "not chosen" — the card then
    // speaks with the app default rather than disappearing or blocking the page.
    fetch('/api/v1/user-settings', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((res) => setUserInflationRatePct(res?.inflation_rate_pct ?? null))
      .catch(() => setUserInflationRatePct(null))
  }, [enabled, goalId, refreshKey, txReload])

  return { transactions, bookNames, txLoading, txError, goldPricePerChi, userInflationRatePct }
}
