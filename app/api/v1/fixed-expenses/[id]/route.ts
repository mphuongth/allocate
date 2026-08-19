import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateText, validateUUID, validateYearMonth } from '@/lib/validation'
import { readJsonBody } from '@/lib/apiBody'
import {
  INVERTED_RANGE_MESSAGE,
  isRangeCheckViolation,
  mergedRangeIsInverted,
  needsStoredRange,
  type RangePatch,
  type StoredRange,
} from '@/lib/effectiveRange'

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

  // Judge the range the table will see, not just the half the body carried: a
  // partial update has to be compared with the endpoint already stored, or it
  // sails past this check and is refused below as a 404 (#686).
  const patch: RangePatch = {}
  if ('effective_from' in body) patch.from = updates.effective_from as string | null
  if ('effective_to' in body) patch.to = updates.effective_to as string | null

  let stored: StoredRange = null
  if (needsStoredRange(patch)) {
    const { data } = await supabase
      .from('fixed_expenses')
      .select('effective_from, effective_to')
      .eq('expense_id', expenseId)
      .eq('user_id', user.id)
      .single()
    stored = data
  }
  if (mergedRangeIsInverted(patch, stored)) {
    return NextResponse.json({ error: INVERTED_RANGE_MESSAGE }, { status: 400 })
  }

  const { data: expense, error } = await supabase
    .from('fixed_expenses')
    .update(updates)
    .eq('expense_id', expenseId)
    .eq('user_id', user.id)
    .select()
    .single()

  // A concurrent update can move the other endpoint between the read above and
  // this write, and then the table refuses the range. That is still a validation
  // failure — reported as 404 it reads as a missing row (#532/#533, #686).
  if (isRangeCheckViolation(error)) {
    return NextResponse.json({ error: INVERTED_RANGE_MESSAGE }, { status: 400 })
  }
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
