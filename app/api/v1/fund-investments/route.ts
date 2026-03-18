import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const fundId = searchParams.get('fund_id')

  let query = supabase
    .from('fund_investments')
    .select('id, fund_id, goal_id, amount_vnd, units_purchased, nav_at_purchase, created_at')
    .eq('user_id', user.id)

  if (fundId) query = query.eq('fund_id', fundId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Failed to fetch investments' }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { plan_id, fund_id, goal_id, amount_vnd, units_purchased, nav_at_purchase } = body

  if (!fund_id) return NextResponse.json({ error: 'Fund is required' }, { status: 400 })
  if (!plan_id) return NextResponse.json({ error: 'plan_id is required' }, { status: 400 })

  const amountNum = Number(amount_vnd)
  const unitsNum = Number(units_purchased)
  const navNum = Number(nav_at_purchase)

  if (!amount_vnd || isNaN(amountNum) || amountNum <= 0) {
    return NextResponse.json({ error: 'Amount and units are required and must be positive' }, { status: 400 })
  }
  if (!units_purchased || isNaN(unitsNum) || unitsNum <= 0) {
    return NextResponse.json({ error: 'Amount and units are required and must be positive' }, { status: 400 })
  }
  if (!nav_at_purchase || isNaN(navNum) || navNum <= 0) {
    return NextResponse.json({ error: 'NAV at purchase must be positive' }, { status: 400 })
  }

  // Verify plan ownership
  const { data: plan } = await supabase.from('monthly_plans').select('id').eq('id', plan_id).eq('user_id', user.id).single()
  if (!plan) return NextResponse.json({ error: 'Plan or fund not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('fund_investments')
    .insert({
      user_id: user.id,
      plan_id,
      fund_id,
      goal_id: goal_id || null,
      amount_vnd: amountNum,
      units_purchased: unitsNum,
      nav_at_purchase: navNum,
    })
    .select('*, funds(name, nav), savings_goals(goal_name)')
    .single()

  if (error) return NextResponse.json({ error: 'Failed to create investment' }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
