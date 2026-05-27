import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateText, validateUUID } from '@/lib/validation'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; expenseId: string }> }) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, expenseId } = await params
  const body = await req.json()
  const { description, amount_vnd } = body

  let planId: string
  let cleanExpenseId: string
  let cleanDescription: string
  let cleanAmount: number
  try {
    planId = validateUUID(id, 'plan_id')
    cleanExpenseId = validateUUID(expenseId, 'expense_id')
    if (!description || (typeof description === 'string' && !description.trim())) {
      throw new ValidationError('Mô tả là bắt buộc')
    }
    cleanDescription = validateText(description, 'description', { max: 500 })
    cleanAmount = validateAmount(amount_vnd, 'amount_vnd')
    if (cleanAmount <= 0) throw new ValidationError('Số tiền phải dương')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const { data: plan } = await supabase
    .from('monthly_plans')
    .select('id')
    .eq('id', planId)
    .eq('user_id', user.id)
    .single()
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('plan_other_expenses')
    .update({ description: cleanDescription, amount_vnd: cleanAmount })
    .eq('id', cleanExpenseId)
    .eq('plan_id', planId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; expenseId: string }> }) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, expenseId } = await params

  let planId: string
  let cleanExpenseId: string
  try {
    planId = validateUUID(id, 'plan_id')
    cleanExpenseId = validateUUID(expenseId, 'expense_id')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  // Verify ownership via plan
  const { data: plan } = await supabase
    .from('monthly_plans')
    .select('id')
    .eq('id', planId)
    .eq('user_id', user.id)
    .single()
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  const { error } = await supabase
    .from('plan_other_expenses')
    .delete()
    .eq('id', cleanExpenseId)
    .eq('plan_id', planId)

  if (error) return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}
