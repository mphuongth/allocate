import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateText, validateUUID, validateYearMonth } from '@/lib/validation'
import { readJsonBody } from '@/lib/apiBody'

function toDateCol(ym: string | undefined | null): string | null {
  if (!ym) return null
  return `${ym}-01`
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body
  const { expense_name, amount_vnd, category, effective_from, effective_to } = body

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  let expenseId: string
  try {
    expenseId = validateUUID(id, 'expense_id')

    if (expense_name !== undefined) {
      updates.expense_name = validateText(expense_name, 'expense_name')
    }
    if (category !== undefined) {
      updates.category = validateText(category, 'category')
    }
    if (amount_vnd !== undefined) {
      const n = validateAmount(amount_vnd, 'amount_vnd')
      if (n <= 0) throw new ValidationError('Amount must be greater than 0.')
      updates.amount_vnd = n
    }
    if ('effective_from' in body) {
      updates.effective_from = effective_from ? toDateCol(validateYearMonth(effective_from, 'effective_from')) : null
    }
    if ('effective_to' in body) {
      updates.effective_to = effective_to ? toDateCol(validateYearMonth(effective_to, 'effective_to')) : null
    }
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const fromDate = (updates.effective_from ?? null) as string | null
  const toDate = (updates.effective_to ?? null) as string | null
  if (fromDate && toDate && fromDate > toDate) {
    return NextResponse.json({ error: '"Active from" must be before "Active until".' }, { status: 400 })
  }

  const { data: expense, error } = await supabase
    .from('fixed_expenses')
    .update(updates)
    .eq('expense_id', expenseId)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error || !expense) return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
  return NextResponse.json(expense)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let expenseId: string
  try {
    expenseId = validateUUID(id, 'expense_id')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('fixed_expenses')
    .delete()
    .eq('expense_id', expenseId)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
  return NextResponse.json({ message: 'Expense deleted.' })
}
