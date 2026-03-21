import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { goal_id, amount_vnd, profit_percent, expiry_date } = body

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (goal_id !== undefined) updates.goal_id = goal_id || null
  if (amount_vnd !== undefined) {
    const n = Number(amount_vnd)
    if (isNaN(n) || n <= 0) return NextResponse.json({ error: 'Amount is required and must be positive' }, { status: 400 })
    updates.amount_vnd = n
  }
  if (profit_percent !== undefined) updates.interest_rate = profit_percent != null ? Number(profit_percent) : null
  if (expiry_date !== undefined) updates.expiry_date = expiry_date || null

  const { data, error } = await supabase
    .from('investment_transactions')
    .update(updates)
    .eq('transaction_id', id)
    .eq('user_id', user.id)
    .select('transaction_id, plan_id, goal_id, amount_vnd, interest_rate, expiry_date, investment_date, created_at, savings_goals(goal_name)')
    .single()

  if (error || !data) return NextResponse.json({ error: 'Saving not found' }, { status: 404 })

  return NextResponse.json({
    id: data.transaction_id,
    plan_id: data.plan_id,
    goal_id: data.goal_id,
    amount_vnd: data.amount_vnd,
    profit_percent: data.interest_rate,
    expiry_date: data.expiry_date,
    created_at: data.created_at,
    savings_goals: data.savings_goals,
  })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('investment_transactions')
    .delete()
    .eq('transaction_id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: 'Saving not found' }, { status: 404 })
  return new NextResponse(null, { status: 204 })
}
