import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validatePlanMonthFilter, validateText, validateUUID, validateYearMonth, type PlanMonthFilter } from '@/lib/validation'
import { validateLinkedDeposit } from './linkValidation'
import { ownershipError } from '@/lib/assertOwned'
import { readJsonBody } from '@/lib/apiBody'

function toDateCol(ym: string | undefined | null): string | null {
  if (!ym) return null
  return `${ym}-01`
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)

  // Validate before the value can reach the `.or(...)` filter string below.
  let planMonth: PlanMonthFilter | null
  try {
    planMonth = validatePlanMonthFilter(searchParams.get('month'), searchParams.get('year'))
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  let query = supabase
    .from('recurring_savings')
    .select('saving_id, name, goal_id, amount_vnd, effective_from, effective_to, linked_deposit_tx_id, unlinked_at, savings_goals(goal_name)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (planMonth) {
    query = query
      .or(`effective_from.is.null,effective_from.lte.${planMonth.planDate}`)
      .or(`effective_to.is.null,effective_to.gte.${planMonth.planDate}`)
  }

  const { data: savings, error } = await query
  if (error) return NextResponse.json({ error: 'Failed to fetch recurring savings' }, { status: 500 })

  // When a specific month is requested, flag the ones already settled for it via
  // a maturity-combine renewal — the maturity "combine" picker uses this to avoid
  // offering (and double-folding) a recurring that's already been folded in.
  if (planMonth && savings && savings.length > 0) {
    const { data: fulfilled, error: fulfilledError } = await supabase
      .from('recurring_saving_fulfillments')
      .select('recurring_saving_id')
      .eq('user_id', user.id)
      .eq('ym', planMonth.ym)
    // Fail closed rather than default every saving to unfulfilled (#533). The
    // combine picker reads this flag to avoid re-folding a recurring that is
    // already folded into a renewed deposit, so the "safe-looking" fallback is
    // in fact the unsafe one: it re-offers settled savings and double-counts.
    if (fulfilledError) {
      console.error('recurring-savings: failed to read fulfillments', fulfilledError.message)
      return NextResponse.json({ error: 'Failed to fetch recurring savings' }, { status: 500 })
    }
    const fulfilledSet = new Set((fulfilled ?? []).map((f) => f.recurring_saving_id))
    return NextResponse.json({
      savings: savings.map((s) => ({ ...s, fulfilled: fulfilledSet.has(s.saving_id) })),
    })
  }

  return NextResponse.json({ savings })
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body
  const { name, goal_id, amount_vnd, effective_from, effective_to, linked_deposit_tx_id } = body

  let cleanName: string
  let cleanGoalId: string | null = null
  let cleanAmount: number
  let cleanFromYm: string | null = null
  let cleanToYm: string | null = null
  let cleanLinkedTxId: string | null = null

  try {
    cleanName = validateText(name, 'name')
    cleanAmount = validateAmount(amount_vnd, 'amount_vnd')
    if (cleanAmount <= 0) throw new ValidationError('Amount must be greater than 0.')
    if (goal_id) cleanGoalId = validateUUID(goal_id, 'goal_id')
    if (effective_from) cleanFromYm = validateYearMonth(effective_from, 'effective_from')
    if (effective_to) cleanToYm = validateYearMonth(effective_to, 'effective_to')
    if (linked_deposit_tx_id) cleanLinkedTxId = validateUUID(linked_deposit_tx_id, 'linked_deposit_tx_id')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const fromDate = toDateCol(cleanFromYm)
  const toDate = toDateCol(cleanToYm)
  if (fromDate && toDate && fromDate > toDate) {
    return NextResponse.json({ error: '"Active from" must be before "Active until".' }, { status: 400 })
  }

  // linked_deposit_tx_id was already ownership-checked by validateLinkedDeposit;
  // goal_id was not — a valid UUID isn't proof of ownership, so a known foreign
  // goal_id could be attached here. The DB trigger (#525) is the backstop.
  if (cleanGoalId) {
    const ownErr = await ownershipError(supabase, 'savings_goals', 'goal_id', cleanGoalId, user.id, 'goal')
    if (ownErr) return ownErr
  }

  if (cleanLinkedTxId) {
    const linkErr = await validateLinkedDeposit(supabase, user.id, cleanLinkedTxId, cleanGoalId)
    if (linkErr) return NextResponse.json({ error: linkErr }, { status: 400 })
  }

  const { data: saving, error } = await supabase
    .from('recurring_savings')
    .insert({
      user_id: user.id,
      name: cleanName,
      goal_id: cleanGoalId,
      amount_vnd: cleanAmount,
      effective_from: fromDate,
      effective_to: toDate,
      linked_deposit_tx_id: cleanLinkedTxId,
    })
    .select('saving_id, name, goal_id, amount_vnd, effective_from, effective_to, linked_deposit_tx_id, savings_goals(goal_name)')
    .single()

  if (error) return NextResponse.json({ error: 'Failed to create recurring saving' }, { status: 500 })
  return NextResponse.json(saving, { status: 201 })
}
