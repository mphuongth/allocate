// The dashboard overview contract (#600).
//
// This is the shape `GET /api/v1/dashboard/overview` returns and the shape the
// dashboard UI, the PDF report, the navigation badge and `lib/dashboardOverview`
// all read. It used to be declared inside `app/assets/DashboardClient.tsx`, so
// the server, the report and the nav each imported a type out of a 1,200-line
// `'use client'` component — a UI edit could break all three, and there was no
// answer to "where does this type belong?".
//
// Layer-neutral by construction: no React, no `'use client'`, no imports. Any
// layer may depend on it; it depends on nothing.

export interface FundBreakdownItem {
  fundId: string
  fundName: string
  fundType: string
  quantity: number
  currentNAV: number
  currentValue: number
  purchasePrice: number
  /** Remaining cost basis (Σ amount_vnd, net of prior sells) — what a sale takes out (#587). */
  costBasis: number
  profitLoss: number
  profitLossPercentage: number
  goalId: string | null
}

export interface GoalData {
  goalId: string
  goalName: string
  targetAmount: number | null
  targetDate: string | null
  currentValue: number
  // Progress-bar numerator: equals currentValue except that affects_progress=false
  // withdrawals are added back, so the bar holds steady while net worth (currentValue)
  // falls. Optional for back-compat with cached overview payloads predating the field.
  progressValue?: number
  totalInvested: number
  profitLoss: number
  profitLossPercentage: number
  progressPercentage: number | null
  transactionCount: number
  funds: FundBreakdownItem[]
  nonFunds?: NonFundUnallocatedItem[]
  // "Ví chờ gộp": settle-with-hold settlements still pooled in this goal. Shown as
  // a "đang chờ gộp" chip (with unhold) and preselected in the anchor's merge sheet.
  // transactionId is the held WITHDRAWAL row. Optional for cached payloads.
  heldForMerge?: Array<{ transactionId: string; amount: number; anchorInvId: string | null; name: string | null }>
}

export interface InsuranceData {
  insuranceId: string
  insuranceName: string
  coverageType: string | null
  annualPremium: number
  amountSaved: number
  savingsProgressPercentage: number
  status: 'on_track' | 'upcoming' | 'overdue' | 'completed' | 'ready'
  nextPaymentDate: string | null
  lastPaymentDate: string | null
}

export interface NonFundUnallocatedItem {
  transactionId: string
  type: string
  amount: number
  currentValue: number
  interestRate: number | null
  expiryDate: string | null
  investmentDate: string
  notes: string | null
  units: number | null
  // Set on a tranche of an accumulating book — keeps the book out of the
  // maturity "needs attention" card (it isn't renewed via the single-row flow).
  depositGroupId?: string | null
  // Structured bank (FK) + currency + pledged flag — null/false on legacy
  // deposits. Drive the merge destination-bank default and the eligibility
  // "same currency" / "not pledged" rules (see lib/mergeEligibility).
  bankCode?: string | null
  currency?: string | null
  isPledged?: boolean | null
}

export interface DashboardData {
  netWorth: {
    totalAssets: number
    totalLiabilities: number
    netWorth: number
    totalInvested: number
    currentValue: number
    overallProfitLoss: number
    overallProfitLossPercentage: number
    navStale: boolean
    hasGold: boolean
    navUpdatedAt: string | null
  }
  goals: GoalData[]
  unallocated: { totalValue: number; funds: FundBreakdownItem[]; nonFunds: NonFundUnallocatedItem[] }
  byType: { bank: number; gold: number; stock: number }
  goldUnits?: number
  insurance: InsuranceData[]
}

// A holding as the goal-detail views and the maturity flows render it: one row
// per fund position / deposit / book, already valued. Declared here rather than
// in `goalDetailShared.tsx` because the maturity grouping (a pure module) and
// the nav badge read it too (#600).
export interface InvRow {
  id: string
  name: string
  type: string
  value: number
  gainPct: number | null
  units: number | null
  principal: number | null
  interestRate: number | null
  // Bank deposit maturity (YYYY-MM-DD); null for non-bank holdings or no term.
  expiryDate: string | null
  // When the (current) cycle was opened — used to derive the original term
  // length on renewal. null for fund holdings.
  investmentDate: string | null
  fund: FundBreakdownItem | null
  // Set for an accumulating ("Loại 2") book — the deposit_group_id its tranches
  // share. Keeps the whole book out of the single-row term renew path and tells
  // the UI to offer a top-up. null for term / one-off holdings.
  depositGroupId?: string | null
  // Structured bank reference (FK to banks.code) for a bank deposit; null for a
  // non-bank holding or a deposit with no bank set yet. Drives the multi-source
  // merge destination-bank default and the "N nguồn · M ngân hàng" provenance.
  bankCode?: string | null
  // Currency (default 'VND') + collateral flag. Carried for the merge eligibility
  // rules ("same currency" / "not pledged"). null/false on legacy deposits.
  currency?: string | null
  isPledged?: boolean | null
  // The book's tranches (top-ups), newest first, for the detail view. Each is one
  // underlying row; present only on an accumulating book row.
  tranches?: InvTranche[] | null
  // A rolled-up recurring saving: real value in the goal, but backed by a plan
  // definition instead of an investment_transactions row. There is no transaction
  // to withdraw, sell, unassign or renew — every surface must withhold those
  // actions rather than post the synthesized id the API rejects (#640).
  isRecurring?: boolean
}

// One top-up of an accumulating book: an underlying investment_transactions row,
// already net of any withdrawal parented to it.
export interface InvTranche {
  id: string
  date: string
  amount: number
  rate: number | null
  value: number
}

// What a sell/withdraw sheet is handed: the holding being closed, plus the
// identifiers the API needs. Built by `dashboardModel` and by the goal-detail
// views, so it lives with the contracts rather than in the sheet (#602).
export interface SellItem {
  type: 'fund' | 'bank' | 'gold' | 'stock'
  name: string
  currentValue: number
  units?: number
  navPerUnit?: number
  gainPct?: number
  interestRate?: number
  // API identifiers
  fundId?: string
  transactionId?: string
  purchasePrice?: number
  /** Fund only: remaining cost basis of the bucket, which a sale draws from (#587). */
  costBasis?: number
  // Set when this bank item is an accumulating book (its anchor id). Switches the
  // sheet to a FULL close: every tranche is withdrawn at once (no partial amount).
  depositGroupId?: string | null
}
