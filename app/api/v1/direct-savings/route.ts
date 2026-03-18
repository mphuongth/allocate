import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { plan_id, goal_id, amount_vnd, profit_percent, expiry_date } = body

  if (!plan_id) return NextResponse.json({ error: 'plan_id is required' }, { status: 400 })

  const amountNum = Number(amount_vnd)
  if (!amount_vnd || isNaN(amountNum) || amountNum <= 0) {
    return NextResponse.json({ error: 'Amount is required and must be positive' }, { status: 400 })
  }

  const { data: plan } = await supabase.from('monthly_plans').select('id').eq('id', plan_id).eq('user_id', user.id).single()
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('direct_savings')
    .insert({
      user_id: user.id,
      plan_id,
      goal_id: goal_id || null,
      amount_vnd: amountNum,
      profit_percent: profit_percent != null ? Number(profit_percent) : null,
      expiry_date: expiry_date || null,
    })
    .select('*, savings_goals(goal_name)')
    .single()

  if (error) return NextResponse.json({ error: 'Failed to create saving' }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
