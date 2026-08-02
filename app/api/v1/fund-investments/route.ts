import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateDate, validateUUID } from '@/lib/validation'
import { readJsonBody } from '@/lib/apiBody'
import { todayIso } from '@/lib/dates'

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const fundId = searchParams.get('fund_id')
  const goalId = searchParams.get('goal_id')

  let query = supabase
    .from('investment_transactions')
    .select('transaction_id, fund_id, goal_id, amount_vnd, units, unit_price, investment_date, created_at, is_dca_seeded, funds(id, name, nav), savings_goals(goal_name)')
    .eq('user_id', user.id)
    .eq('asset_type', 'fund')
    .or('is_dca_seeded.eq.false,units.not.is.null')
    .order('created_at', { ascending: false })

  if (fundId) query = query.eq('fund_id', fundId)
  if (goalId) query = query.eq('goal_id', goalId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Failed to fetch investments' }, { status: 500 })

  // Map to legacy shape for backward compatibility
  const mapped = (data ?? []).map((row) => ({
    id: row.transaction_id,
    fund_id: row.fund_id,
    goal_id: row.goal_id,
    amount_vnd: row.amount_vnd,
    units_purchased: row.units,
    nav_at_purchase: row.unit_price,
    investment_date: row.investment_date,
    created_at: row.created_at,
    is_dca_seeded: row.is_dca_seeded,
    funds: row.funds,
    savings_goals: row.savings_goals,
  }))

  return NextResponse.json(mapped)
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body
  const { plan_id, fund_id, goal_id, amount_vnd, units_purchased, nav_at_purchase, investment_date } = body

  let cleanFundId: string
  let cleanAmount: number
  let cleanUnits: number
  let cleanNav: number
  let cleanGoalId: string | null = null
  let cleanPlanId: string | null = null
  let cleanInvestmentDate: string

  try {
    if (!fund_id) throw new ValidationError('Fund is required')
    cleanFundId = validateUUID(fund_id, 'fund_id')
    cleanAmount = validateAmount(amount_vnd, 'amount_vnd')
    if (cleanAmount <= 0) throw new ValidationError('Amount must be greater than 0')
    cleanUnits = validateAmount(units_purchased, 'units_purchased')
    if (cleanUnits <= 0) throw new ValidationError('Units must be greater than 0')
    cleanNav = validateAmount(nav_at_purchase, 'nav_at_purchase')
    if (cleanNav <= 0) throw new ValidationError('NAV at purchase must be positive')
    if (goal_id) cleanGoalId = validateUUID(goal_id, 'goal_id')
    if (plan_id) cleanPlanId = validateUUID(plan_id, 'plan_id')
    cleanInvestmentDate = investment_date
      ? validateDate(investment_date, 'investment_date')
      : todayIso()
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  // A well-formed UUID is not proof of ownership, and neither fund_id nor
  // goal_id is protected by an FK back to the caller — so a known foreign id
  // would link this holding to someone else's fund or goal and report success
  // (#586, the same hole the canonical route closed in #474).
  const { data: fund } = await supabase
    .from('funds')
    .select('id')
    .eq('id', cleanFundId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!fund) return NextResponse.json({ error: "You don't have permission to access this fund." }, { status: 403 })

  if (cleanGoalId) {
    const { data: goal } = await supabase
      .from('savings_goals')
      .select('goal_id')
      .eq('goal_id', cleanGoalId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!goal) return NextResponse.json({ error: "You don't have permission to access this goal." }, { status: 403 })
  }

  if (cleanPlanId) {
    const { data: plan } = await supabase.from('monthly_plans').select('id').eq('id', cleanPlanId).eq('user_id', user.id).single()
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  }

  const { data, error } = await supabase
    .from('investment_transactions')
    .insert({
      user_id: user.id,
      plan_id: cleanPlanId,
      fund_id: cleanFundId,
      goal_id: cleanGoalId,
      asset_type: 'fund',
      amount_vnd: cleanAmount,
      units: cleanUnits,
      unit_price: cleanNav,
      investment_date: cleanInvestmentDate,
    })
    .select('transaction_id, fund_id, goal_id, amount_vnd, units, unit_price, investment_date, created_at, funds(id, name, nav), savings_goals(goal_name)')
    .single()

  if (error) return NextResponse.json({ error: 'Failed to create investment' }, { status: 500 })

  const mapped = {
    id: data.transaction_id,
    fund_id: data.fund_id,
    goal_id: data.goal_id,
    amount_vnd: data.amount_vnd,
    units_purchased: data.units,
    nav_at_purchase: data.unit_price,
    investment_date: data.investment_date,
    created_at: data.created_at,
    funds: data.funds,
    savings_goals: data.savings_goals,
  }

  return NextResponse.json(mapped, { status: 201 })
}
