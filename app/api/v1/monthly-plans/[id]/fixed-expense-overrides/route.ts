import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateUUID } from '@/lib/validation'

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
    .from('fixed_expense_overrides')
    .select('*, fixed_expenses(expense_name, amount_vnd)')
    .eq('plan_id', planId)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: 'Failed to fetch overrides' }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { fixed_expense_id, monthly_amount_override_vnd } = body

  let planId: string
  let cleanExpenseId: string
  let cleanAmount: number
  try {
    planId = validateUUID(id, 'plan_id')
    if (!fixed_expense_id) throw new ValidationError('fixed_expense_id is required')
    cleanExpenseId = validateUUID(fixed_expense_id, 'fixed_expense_id')
    if (monthly_amount_override_vnd === undefined || monthly_amount_override_vnd === null) {
      throw new ValidationError('Monthly amount must be 0 or positive')
    }
    cleanAmount = validateAmount(monthly_amount_override_vnd, 'monthly_amount_override_vnd')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const { data: plan } = await supabase.from('monthly_plans').select('id').eq('id', planId).eq('user_id', user.id).single()
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  // Upsert — one override per expense per plan
  const { data, error } = await supabase
    .from('fixed_expense_overrides')
    .upsert(
      { plan_id: planId, fixed_expense_id: cleanExpenseId, monthly_amount_override_vnd: cleanAmount, updated_at: new Date().toISOString() },
      { onConflict: 'plan_id,fixed_expense_id' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Failed to save override' }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
