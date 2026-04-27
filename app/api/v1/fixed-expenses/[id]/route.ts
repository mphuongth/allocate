import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function toDateCol(ym: string | undefined | null): string | null {
  if (!ym) return null
  return `${ym}-01`
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { expense_name, amount_vnd, category, effective_from, effective_to } = body

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (expense_name !== undefined) {
    if (!expense_name || expense_name.trim().length === 0) {
      return NextResponse.json({ error: 'Expense name is required.' }, { status: 400 })
    }
    updates.expense_name = expense_name.trim()
  }
  if (category !== undefined) {
    if (!category || category.trim().length === 0) {
      return NextResponse.json({ error: 'Category is required.' }, { status: 400 })
    }
    updates.category = category.trim()
  }
  if (amount_vnd !== undefined) {
    const amountNum = Number(amount_vnd)
    if (isNaN(amountNum) || amountNum <= 0) {
      return NextResponse.json({ error: 'Amount must be greater than 0.' }, { status: 400 })
    }
    updates.amount_vnd = amountNum
  }
  if ('effective_from' in body) updates.effective_from = toDateCol(effective_from)
  if ('effective_to' in body) updates.effective_to = toDateCol(effective_to)

  const fromDate = (updates.effective_from ?? null) as string | null
  const toDate = (updates.effective_to ?? null) as string | null
  if (fromDate && toDate && fromDate > toDate) {
    return NextResponse.json({ error: '"Active from" must be before "Active until".' }, { status: 400 })
  }

  const { data: expense, error } = await supabase
    .from('fixed_expenses')
    .update(updates)
    .eq('expense_id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error || !expense) return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
  return NextResponse.json(expense)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('fixed_expenses')
    .delete()
    .eq('expense_id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
  return NextResponse.json({ message: 'Expense deleted.' })
}
