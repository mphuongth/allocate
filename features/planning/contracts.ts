// The monthly plan's contracts (#603).
//
// These are the shapes `/api/v1/monthly-plans?full=true` returns and the two
// planning views render. They were declared inside `PlanningClient.tsx` — a
// `'use client'` component — which meant the shared derivations, actions and
// row model all had to import a type out of `app/`, the wrong direction under
// docs/architecture.md. `PlanningClient` re-exports them, so existing imports
// keep working.

export interface MonthlyPlan {
  id: string
  month: number
  year: number
  salary_vnd: number
}

export interface FundInvestment {
  transaction_id: string
  plan_id: string
  fund_id: string
  goal_id: string | null
  amount_vnd: number
  units: number | null
  unit_price: number | null
  investment_date: string | null
  is_dca_seeded: boolean
  funds: { name: string; nav: number } | null
  savings_goals: { goal_name: string } | null
}

export interface DirectSaving {
  transaction_id: string
  plan_id: string
  goal_id: string | null
  amount_vnd: number
  interest_rate: number | null
  expiry_date: string | null
  investment_date: string
  savings_goals: { goal_name: string } | null
}

export interface FixedExpense {
  expense_id: string
  expense_name: string
  amount_vnd: number
  override?: number // overridden monthly amount if set
}

export interface InsuranceMember {
  member_id: string
  member_name: string
  relationship: string
  annual_payment_vnd: number
  payment_date: string | null
  excluded?: boolean
  monthlyOverride?: number
}

export interface OtherExpense {
  id: string
  plan_id: string
  description: string
  amount_vnd: number
  created_at: string
}

export interface RecurringSaving {
  saving_id: string
  name: string
  goal_id: string | null
  amount_vnd: number
  effective_from: string | null
  effective_to: string | null
  linked_deposit_tx_id?: string | null
  savings_goals: { goal_name: string } | null
}

export interface RecurringSavingOverride {
  recurring_saving_id: string
  monthly_amount_override_vnd: number
}

// A recurring recorded this month via maturity-combine / book top-up. amount_vnd
// is what was fulfilled; source distinguishes whether a plan-scoped deposit was
// also logged (book top-up) so contributed isn't double-counted.
export interface RecurringFulfillment {
  recurring_saving_id: string
  amount_vnd: number
  source: string
}

export interface Fund {
  id: string; name: string; nav: number
  is_dca?: boolean
  dca_monthly_amount_vnd?: number | null
  dca_goal_id?: string | null
}

export interface DcaSkip { fund_id: string }
export interface Goal { goal_id: string; goal_name: string }
