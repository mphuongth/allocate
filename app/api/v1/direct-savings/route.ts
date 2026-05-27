import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateDate, validateRate, validateUUID } from '@/lib/validation'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('investment_transactions')
    .select('transaction_id, plan_id, goal_id, amount_vnd, interest_rate, expiry_date, investment_date, created_at, savings_goals(goal_name)')
    .eq('user_id', user.id)
    .eq('asset_type', 'bank')
    .not('plan_id', 'is', null)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Failed to fetch savings' }, { status: 500 })

  const mapped = (data ?? []).map((row) => ({
    id: row.transaction_id,
    plan_id: row.plan_id,
    goal_id: row.goal_id,
    amount_vnd: row.amount_vnd,
    profit_percent: row.interest_rate,
    expiry_date: row.expiry_date,
    created_at: row.created_at,
    savings_goals: row.savings_goals,
  }))

  return NextResponse.json(mapped)
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { plan_id, goal_id, amount_vnd, profit_percent, expiry_date, investment_date } = body

  let cleanPlanId: string
  let cleanAmount: number
  let cleanGoalId: string | null = null
  let cleanProfit: number | null = null
  let cleanExpiry: string | null = null
  let cleanInvestmentDate: string

  try {
    if (!plan_id) throw new ValidationError('plan_id is required')
    cleanPlanId = validateUUID(plan_id, 'plan_id')
    cleanAmount = validateAmount(amount_vnd, 'amount_vnd')
    if (cleanAmount <= 0) throw new ValidationError('Amount is required and must be positive')
    if (goal_id) cleanGoalId = validateUUID(goal_id, 'goal_id')
    if (profit_percent != null && profit_percent !== '') cleanProfit = validateRate(profit_percent, 'profit_percent')
    if (expiry_date) cleanExpiry = validateDate(expiry_date, 'expiry_date')
    cleanInvestmentDate = investment_date
      ? validateDate(investment_date, 'investment_date')
      : new Date().toISOString().slice(0, 10)
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const { data: plan } = await supabase.from('monthly_plans').select('id').eq('id', cleanPlanId).eq('user_id', user.id).single()
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('investment_transactions')
    .insert({
      user_id: user.id,
      plan_id: cleanPlanId,
      goal_id: cleanGoalId,
      asset_type: 'bank',
      amount_vnd: cleanAmount,
      interest_rate: cleanProfit,
      expiry_date: cleanExpiry,
      investment_date: cleanInvestmentDate,
    })
    .select('transaction_id, plan_id, goal_id, amount_vnd, interest_rate, expiry_date, investment_date, created_at, savings_goals(goal_name)')
    .single()

  if (error) return NextResponse.json({ error: 'Failed to create saving' }, { status: 500 })

  return NextResponse.json({
    id: data.transaction_id,
    plan_id: data.plan_id,
    goal_id: data.goal_id,
    amount_vnd: data.amount_vnd,
    profit_percent: data.interest_rate,
    expiry_date: data.expiry_date,
    created_at: data.created_at,
    savings_goals: data.savings_goals,
  }, { status: 201 })
}
