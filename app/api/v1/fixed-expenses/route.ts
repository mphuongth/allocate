import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validatePlanMonthFilter, validateText, validateYearMonth, type PlanMonthFilter } from '@/lib/validation'

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

  // Validate before the value can reach the `.or(...)` filter string below.
  let planMonth: PlanMonthFilter | null
  try {
    planMonth = validatePlanMonthFilter(searchParams.get('month'), searchParams.get('year'))
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  let query = supabase
    .from('fixed_expenses')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (category) query = query.eq('category', category)

  if (planMonth) {
    query = query
      .or(`effective_from.is.null,effective_from.lte.${planMonth.planDate}`)
      .or(`effective_to.is.null,effective_to.gte.${planMonth.planDate}`)
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

  let cleanName: string
  let cleanCategory: string
  let cleanAmount: number
  let cleanFromYm: string | null = null
  let cleanToYm: string | null = null

  try {
    cleanName = validateText(expense_name, 'expense_name')
    cleanCategory = validateText(category, 'category')
    cleanAmount = validateAmount(amount_vnd, 'amount_vnd')
    if (cleanAmount <= 0) throw new ValidationError('Amount must be greater than 0.')
    if (effective_from) cleanFromYm = validateYearMonth(effective_from, 'effective_from')
    if (effective_to) cleanToYm = validateYearMonth(effective_to, 'effective_to')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const fromDate = toDateCol(cleanFromYm)
  const toDate = toDateCol(cleanToYm)
  if (fromDate && toDate && fromDate > toDate) {
    return NextResponse.json({ error: '"Active from" must be before "Active until".' }, { status: 400 })
  }

  const { data: expense, error } = await supabase
    .from('fixed_expenses')
    .insert({
      user_id: user.id,
      expense_name: cleanName,
      amount_vnd: cleanAmount,
      category: cleanCategory,
      effective_from: fromDate,
      effective_to: toDate,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Failed to create expense' }, { status: 500 })
  return NextResponse.json(expense, { status: 201 })
}
