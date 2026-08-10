// The fund library's contracts (#603).
//
// Declared here rather than in `useFundsData.ts` so the shared list model can
// read them without importing from `app/` — the layer rule in
// docs/architecture.md. `useFundsData` re-exports them, so existing imports
// keep working.

export type FundType = 'balanced' | 'equity' | 'debt' | 'gold'

export type Fund = {
  id: string
  name: string
  code: string
  fund_type: FundType
  nav: number
  nav_auto_sync: boolean
  is_dca: boolean
  dca_monthly_amount_vnd: number | null
  dca_goal_id: string | null
  created_at: string
  updated_at: string
}

export type Goal = { goal_id: string; goal_name: string }

/** Column the fund table/list is ordered by. */
export type SortKey = 'code' | 'nav' | 'name'

/** Fund-type filter chip; 'all' clears the filter. */
export type TypeFilter = 'all' | 'equity' | 'debt' | 'balanced'
