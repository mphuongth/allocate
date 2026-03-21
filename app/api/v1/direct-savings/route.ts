import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

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

  if (!plan_id) return NextResponse.json({ error: 'plan_id is required' }, { status: 400 })

  const amountNum = Number(amount_vnd)
  if (!amount_vnd || isNaN(amountNum) || amountNum <= 0) {
    return NextResponse.json({ error: 'Amount is required and must be positive' }, { status: 400 })
  }

  const { data: plan } = await supabase.from('monthly_plans').select('id').eq('id', plan_id).eq('user_id', user.id).single()
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('investment_transactions')
    .insert({
      user_id: user.id,
      plan_id,
      goal_id: goal_id || null,
      asset_type: 'bank',
      amount_vnd: amountNum,
      interest_rate: profit_percent != null ? Number(profit_percent) : null,
      expiry_date: expiry_date || null,
      investment_date: investment_date || new Date().toISOString().slice(0, 10),
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
