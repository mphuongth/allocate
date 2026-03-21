import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: plan } = await supabase.from('monthly_plans').select('id').eq('id', id).eq('user_id', user.id).single()
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('investment_transactions')
    .select('transaction_id, plan_id, fund_id, goal_id, amount_vnd, units, unit_price, investment_date, funds(name, nav), savings_goals(goal_name)')
    .eq('plan_id', id)
    .eq('asset_type', 'fund')
    .eq('user_id', user.id)
    .order('investment_date', { ascending: true })

  if (error) return NextResponse.json({ error: 'Failed to fetch investments' }, { status: 500 })
  return NextResponse.json(data)
}
