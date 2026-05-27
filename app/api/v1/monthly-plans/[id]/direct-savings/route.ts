import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateUUID } from '@/lib/validation'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let planId: string
  try {
    planId = validateUUID(id, 'plan_id')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: plan } = await supabase.from('monthly_plans').select('id').eq('id', planId).eq('user_id', user.id).single()
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('investment_transactions')
    .select('transaction_id, plan_id, goal_id, amount_vnd, interest_rate, expiry_date, investment_date, savings_goals(goal_name)')
    .eq('plan_id', planId)
    .eq('asset_type', 'bank')
    .eq('user_id', user.id)
    .order('investment_date', { ascending: true })

  if (error) return NextResponse.json({ error: 'Failed to fetch savings' }, { status: 500 })
  return NextResponse.json(data)
}
