import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateUUID } from '@/lib/validation'
import { realizedRecurringContributions } from '@/lib/finance'

// Recurring savings are plan definitions, not logged transactions, so they never
// appear in investment_transactions. This endpoint synthesizes read-only history
// rows for a goal's recurring savings in months that have arrived (real-saved
// model, mirroring insurance) — the same data the dashboard adds to goal
// progress. Rows are shaped like the investment-transactions response so the goal
// detail History tab can merge them directly.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let goalId: string
  try {
    goalId = validateUUID(id, 'goal_id')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [savingsRes, plansRes] = await Promise.all([
    supabase
      .from('recurring_savings')
      .select('saving_id, goal_id, name, amount_vnd, effective_from, effective_to')
      .eq('user_id', user.id)
      .eq('goal_id', goalId),
    supabase
      .from('monthly_plans')
      .select('id, month, year')
      .eq('user_id', user.id),
  ])

  if (savingsRes.error || plansRes.error) {
    return NextResponse.json({ error: 'Failed to fetch recurring contributions' }, { status: 500 })
  }

  const plans = (plansRes.data ?? []) as { id: string; month: number; year: number }[]
  const planIds = plans.map((p) => p.id)

  const [overridesRes, depositsRes, fulfillmentsRes] = await Promise.all([
    planIds.length > 0
      ? supabase
          .from('recurring_saving_overrides')
          .select('plan_id, recurring_saving_id, monthly_amount_override_vnd')
          .in('plan_id', planIds)
      : Promise.resolve({ data: [], error: null }),
    // Real bank deposits logged toward this goal — used to suppress the
    // synthesized recurring row when the user has recorded the actual deposit
    // (otherwise the History tab would show both). Exclude renewal snapshots
    // (renewed_from set): a closed cycle isn't a live deposit and is already kept
    // out of net worth, but it's still a bank/investment row in this goal, so it
    // would leak into the pool and could wrongly suppress a recurring whose
    // (month, goal, amount) happens to match it. The dashboard overview builds its
    // pool from the same snapshot-excluded set — keep them consistent.
    supabase
      .from('investment_transactions')
      .select('goal_id, amount_vnd, investment_date')
      .eq('user_id', user.id)
      .eq('goal_id', goalId)
      .eq('asset_type', 'bank')
      .eq('transaction_type', 'investment')
      .is('renewed_from_transaction_id', null),
    // Months already settled by folding the recurring into a renewed/topped-up
    // deposit. The amount lives in that deposit's principal, so the synthesized
    // row must be skipped here too — the dashboard overview already honours these,
    // and the goal detail must agree or the goal shows the contribution twice.
    supabase
      .from('recurring_saving_fulfillments')
      .select('recurring_saving_id, ym')
      .eq('user_id', user.id),
  ])

  // All three refine the synthesized rows, and two of them do so by SUPPRESSING
  // one: a logged deposit means the user already recorded the real transfer, a
  // fulfillment means the amount is already inside a renewed deposit's
  // principal. Defaulting either to [] on failure doesn't lose history — it
  // emits the duplicate they exist to cancel, so the goal shows the same
  // contribution twice. A failed overrides read just computes the wrong
  // amount. None of that may hide behind a 200 (#532).
  if (overridesRes.error || depositsRes.error || fulfillmentsRes.error) {
    console.error(
      'recurring contributions: failed to read reconciliation sources —',
      [
        overridesRes.error && `recurring_saving_overrides: ${overridesRes.error.message}`,
        depositsRes.error && `investment_transactions: ${depositsRes.error.message}`,
        fulfillmentsRes.error && `recurring_saving_fulfillments: ${fulfillmentsRes.error.message}`,
      ]
        .filter(Boolean)
        .join('; '),
    )
    return NextResponse.json({ error: 'Failed to fetch recurring contributions' }, { status: 500 })
  }

  const loggedDeposits = (depositsRes.data ?? []).map((d) => ({
    month: String(d.investment_date).slice(0, 7),
    goalId: d.goal_id,
    amount: d.amount_vnd,
  }))

  const contributions = realizedRecurringContributions(
    savingsRes.data ?? [],
    plans,
    overridesRes.data ?? [],
    loggedDeposits,
    fulfillmentsRes.data ?? [],
  )

  // Shape as read-only history rows mirroring the investment-transactions response.
  const rows = contributions.map((c) => ({
    transaction_id: `recurring:${c.savingId}:${c.date}`,
    transaction_type: 'investment',
    asset_type: 'bank',
    fund_id: null,
    fund_name: null,
    fund_code: null,
    parent_transaction_id: null,
    investment_date: c.date,
    amount_vnd: c.amount,
    units: null,
    unit_price: null,
    interest_rate: null,
    expiry_date: null,
    notes: c.name,
    principal_withdrawn: null,
    units_withdrawn: null,
    is_recurring: true,
  }))

  return NextResponse.json({ contributions: rows })
}
