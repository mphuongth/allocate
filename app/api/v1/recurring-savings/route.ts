import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateText, validateUUID, validateYearMonth } from '@/lib/validation'

function toDateCol(ym: string | undefined | null): string | null {
  if (!ym) return null
  return `${ym}-01`
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month')
  const year = searchParams.get('year')

  let query = supabase
    .from('recurring_savings')
    .select('saving_id, name, goal_id, amount_vnd, effective_from, effective_to, savings_goals(goal_name)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (month && year) {
    const planDate = `${year}-${String(month).padStart(2, '0')}-01`
    query = query
      .or(`effective_from.is.null,effective_from.lte.${planDate}`)
      .or(`effective_to.is.null,effective_to.gte.${planDate}`)
  }

  const { data: savings, error } = await query
  if (error) return NextResponse.json({ error: 'Failed to fetch recurring savings' }, { status: 500 })

  // When a specific month is requested, flag the ones already settled for it via
  // a maturity-combine renewal — the maturity "combine" picker uses this to avoid
  // offering (and double-folding) a recurring that's already been folded in.
  if (month && year && savings && savings.length > 0) {
    const ym = `${year}-${String(month).padStart(2, '0')}`
    const { data: fulfilled } = await supabase
      .from('recurring_saving_fulfillments')
      .select('recurring_saving_id')
      .eq('user_id', user.id)
      .eq('ym', ym)
    const fulfilledSet = new Set((fulfilled ?? []).map((f) => f.recurring_saving_id))
    return NextResponse.json({
      savings: savings.map((s) => ({ ...s, fulfilled: fulfilledSet.has(s.saving_id) })),
    })
  }

  return NextResponse.json({ savings })
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, goal_id, amount_vnd, effective_from, effective_to } = body

  let cleanName: string
  let cleanGoalId: string | null = null
  let cleanAmount: number
  let cleanFromYm: string | null = null
  let cleanToYm: string | null = null

  try {
    cleanName = validateText(name, 'name')
    cleanAmount = validateAmount(amount_vnd, 'amount_vnd')
    if (cleanAmount <= 0) throw new ValidationError('Amount must be greater than 0.')
    if (goal_id) cleanGoalId = validateUUID(goal_id, 'goal_id')
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

  const { data: saving, error } = await supabase
    .from('recurring_savings')
    .insert({
      user_id: user.id,
      name: cleanName,
      goal_id: cleanGoalId,
      amount_vnd: cleanAmount,
      effective_from: fromDate,
      effective_to: toDate,
    })
    .select('saving_id, name, goal_id, amount_vnd, effective_from, effective_to, savings_goals(goal_name)')
    .single()

  if (error) return NextResponse.json({ error: 'Failed to create recurring saving' }, { status: 500 })
  return NextResponse.json(saving, { status: 201 })
}
