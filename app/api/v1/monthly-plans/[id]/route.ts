import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateUUID } from '@/lib/validation'
import { readJsonBody } from '@/lib/apiBody'

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

  const { data: plan, error } = await supabase
    .from('monthly_plans')
    .select('*')
    .eq('id', planId)
    .eq('user_id', user.id)
    .single()

  if (error || !plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  return NextResponse.json(plan)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  // Verify plan exists and belongs to user
  const { data: plan, error: fetchError } = await supabase
    .from('monthly_plans')
    .select('id, month, year, user_id')
    .eq('id', planId)
    .single()

  if (fetchError || !plan) return NextResponse.json({ error: 'Salary record not found' }, { status: 404 })
  if (plan.user_id !== user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Delete the plan in a single statement and let the database do the rest, so
  // the whole operation is atomic — a failure rolls back with nothing orphaned.
  // Every plan-scoped child FK is ON DELETE CASCADE and is retired automatically:
  //   fixed_expense_overrides, plan_other_expenses, plan_dca_skips,
  //   recurring_saving_overrides, plan_excluded_insurance_members,
  //   plan_insurance_member_overrides.
  // investment_transactions.plan_id is ON DELETE SET NULL, so recorded buys
  // survive the plan (just unlinked), while a BEFORE DELETE trigger on
  // monthly_plans removes the plan's *pending* seeded DCA rows (is_dca_seeded,
  // units IS NULL) — planning state that must not outlive the plan. Both run in
  // the same transaction as the delete, so the whole thing stays atomic. The old
  // code hand-deleted overrides in a separate request first, which could lose
  // them if the plan delete then failed (#472).
  const { error: planError } = await supabase
    .from('monthly_plans')
    .delete()
    .eq('id', planId)
    .eq('user_id', user.id)

  if (planError) {
    return NextResponse.json({ error: 'Failed to delete salary record. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({
    data: { id: planId, status: 'deleted', month: plan.month, year: plan.year },
    message: 'Salary record deleted successfully',
  })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body

  let planId: string
  let cleanSalary: number
  try {
    planId = validateUUID(id, 'plan_id')
    cleanSalary = validateAmount(body.salary_vnd, 'salary_vnd')
    if (cleanSalary <= 0) throw new ValidationError('Salary must be positive')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const { data: plan, error } = await supabase
    .from('monthly_plans')
    .update({ salary_vnd: cleanSalary, updated_at: new Date().toISOString() })
    .eq('id', planId)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error || !plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  return NextResponse.json(plan)
}
