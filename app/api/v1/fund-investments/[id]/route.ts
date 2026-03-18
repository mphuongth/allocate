import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { fund_id, goal_id, amount_vnd, units_purchased, nav_at_purchase, investment_date } = body

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (fund_id !== undefined) updates.fund_id = fund_id
  if (goal_id !== undefined) updates.goal_id = goal_id || null

  if (amount_vnd !== undefined) {
    const n = Number(amount_vnd)
    if (isNaN(n) || n <= 0) return NextResponse.json({ error: 'Amount and units are required and must be positive' }, { status: 400 })
    updates.amount_vnd = n
  }
  if (units_purchased !== undefined) {
    const n = Number(units_purchased)
    if (isNaN(n) || n <= 0) return NextResponse.json({ error: 'Amount and units are required and must be positive' }, { status: 400 })
    updates.units_purchased = n
  }
  if (nav_at_purchase !== undefined) {
    const n = Number(nav_at_purchase)
    if (isNaN(n) || n <= 0) return NextResponse.json({ error: 'NAV at purchase must be positive' }, { status: 400 })
    updates.nav_at_purchase = n
  }
  if (investment_date !== undefined) updates.investment_date = investment_date || null

  const { data, error } = await supabase
    .from('fund_investments')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*, funds(name, nav), savings_goals(goal_name)')
    .single()

  if (error || !data) return NextResponse.json({ error: 'Investment not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase.from('fund_investments').delete().eq('id', id).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: 'Investment not found' }, { status: 404 })
  return new NextResponse(null, { status: 204 })
}
