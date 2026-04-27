import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function toDateCol(ym: string | undefined | null): string | null {
  if (!ym) return null
  return `${ym}-01`
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category')
  const month = searchParams.get('month')
  const year = searchParams.get('year')

  let query = supabase
    .from('fixed_expenses')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (category) query = query.eq('category', category)

  if (month && year) {
    const planDate = `${year}-${String(month).padStart(2, '0')}-01`
    query = query
      .or(`effective_from.is.null,effective_from.lte.${planDate}`)
      .or(`effective_to.is.null,effective_to.gte.${planDate}`)
  }

  const { data: expenses, error } = await query
  if (error) return NextResponse.json({ error: 'Failed to fetch expenses' }, { status: 500 })
  return NextResponse.json({ expenses })
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { expense_name, amount_vnd, category, effective_from, effective_to } = body

  if (!expense_name || typeof expense_name !== 'string' || expense_name.trim().length === 0) {
    return NextResponse.json({ error: 'Expense name is required.' }, { status: 400 })
  }
  if (!category || typeof category !== 'string' || category.trim().length === 0) {
    return NextResponse.json({ error: 'Category is required.' }, { status: 400 })
  }
  const amountNum = Number(amount_vnd)
  if (!amount_vnd || isNaN(amountNum) || amountNum <= 0) {
    return NextResponse.json({ error: 'Amount must be greater than 0.' }, { status: 400 })
  }

  const fromDate = toDateCol(effective_from)
  const toDate = toDateCol(effective_to)
  if (fromDate && toDate && fromDate > toDate) {
    return NextResponse.json({ error: '"Active from" must be before "Active until".' }, { status: 400 })
  }

  const { data: expense, error } = await supabase
    .from('fixed_expenses')
    .insert({
      user_id: user.id,
      expense_name: expense_name.trim(),
      amount_vnd: amountNum,
      category: category.trim(),
      effective_from: fromDate,
      effective_to: toDate,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Failed to create expense' }, { status: 500 })
  return NextResponse.json(expense, { status: 201 })
}
