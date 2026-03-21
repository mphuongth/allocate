import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const fundId = searchParams.get('fund_id')
  const goalId = searchParams.get('goal_id')

  let query = supabase
    .from('investment_transactions')
    .select('transaction_id, fund_id, goal_id, amount_vnd, units, unit_price, investment_date, created_at, funds(id, name, nav), savings_goals(goal_name)')
    .eq('user_id', user.id)
    .eq('asset_type', 'fund')
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
    funds: row.funds,
    savings_goals: row.savings_goals,
  }))

  return NextResponse.json(mapped)
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { plan_id, fund_id, goal_id, amount_vnd, units_purchased, nav_at_purchase, investment_date } = body

  if (!fund_id) return NextResponse.json({ error: 'Fund is required' }, { status: 400 })

  const amountNum = Number(amount_vnd)
  const unitsNum = Number(units_purchased)
  const navNum = Number(nav_at_purchase)

  if (!amount_vnd || isNaN(amountNum) || amountNum <= 0) {
    return NextResponse.json({ error: 'Amount must be greater than 0' }, { status: 400 })
  }
  if (!units_purchased || isNaN(unitsNum) || unitsNum <= 0) {
    return NextResponse.json({ error: 'Units must be greater than 0' }, { status: 400 })
  }
  if (!nav_at_purchase || isNaN(navNum) || navNum <= 0) {
    return NextResponse.json({ error: 'NAV at purchase must be positive' }, { status: 400 })
  }

  if (plan_id) {
    const { data: plan } = await supabase.from('monthly_plans').select('id').eq('id', plan_id).eq('user_id', user.id).single()
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  }

  const { data, error } = await supabase
    .from('investment_transactions')
    .insert({
      user_id: user.id,
      plan_id: plan_id || null,
      fund_id,
      goal_id: goal_id || null,
      asset_type: 'fund',
      amount_vnd: amountNum,
      units: unitsNum,
      unit_price: navNum,
      investment_date: investment_date || new Date().toISOString().slice(0, 10),
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
