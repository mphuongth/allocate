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
    .from('fixed_expense_overrides')
    .select('*, fixed_expenses(expense_name, amount_vnd)')
    .eq('plan_id', id)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: 'Failed to fetch overrides' }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: plan } = await supabase.from('monthly_plans').select('id').eq('id', id).eq('user_id', user.id).single()
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  const body = await request.json()
  const { fixed_expense_id, monthly_amount_override_vnd } = body

  const amountNum = Number(monthly_amount_override_vnd)
  if (!fixed_expense_id) return NextResponse.json({ error: 'fixed_expense_id is required' }, { status: 400 })
  if (monthly_amount_override_vnd === undefined || monthly_amount_override_vnd === null || isNaN(amountNum) || amountNum < 0) {
    return NextResponse.json({ error: 'Monthly amount must be 0 or positive' }, { status: 400 })
  }

  // Upsert — one override per expense per plan
  const { data, error } = await supabase
    .from('fixed_expense_overrides')
    .upsert(
      { plan_id: id, fixed_expense_id, monthly_amount_override_vnd: amountNum, updated_at: new Date().toISOString() },
      { onConflict: 'plan_id,fixed_expense_id' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Failed to save override' }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
