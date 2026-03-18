import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { expense_name, amount_vnd, category } = body

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
