import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: plan, error } = await supabase
    .from('monthly_plans')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  return NextResponse.json(plan)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify plan exists and belongs to user
  const { data: plan, error: fetchError } = await supabase
    .from('monthly_plans')
    .select('id, month, year, user_id')
    .eq('id', id)
    .single()

  if (fetchError || !plan) return NextResponse.json({ error: 'Salary record not found' }, { status: 404 })
  if (plan.user_id !== user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Delete child records, then the plan
  // investment_transactions.plan_id has ON DELETE SET NULL — no explicit delete needed
  const overrideDel = await supabase.from('fixed_expense_overrides').delete().eq('plan_id', id)

  if (overrideDel.error) {
    return NextResponse.json({ error: 'Failed to delete salary record. Please try again.' }, { status: 500 })
  }

  const { error: planError } = await supabase
    .from('monthly_plans')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (planError) {
    return NextResponse.json({ error: 'Failed to delete salary record. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({
    data: { id, status: 'deleted', month: plan.month, year: plan.year },
    message: 'Salary record deleted successfully',
  })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const salaryNum = Number(body.salary_vnd)

  if (!body.salary_vnd || isNaN(salaryNum) || salaryNum <= 0) {
    return NextResponse.json({ error: 'Salary must be positive' }, { status: 400 })
  }

  const { data: plan, error } = await supabase
    .from('monthly_plans')
    .update({ salary_vnd: salaryNum, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error || !plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  return NextResponse.json(plan)
}
