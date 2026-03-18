import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const ASSET_TYPES = ['fund', 'bank', 'stock', 'gold'] as const

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const asset_type = searchParams.get('asset_type')
  const from_date = searchParams.get('from_date')
  const to_date = searchParams.get('to_date')
  const goal_id = searchParams.get('goal_id')
  const unassigned = searchParams.get('unassigned')
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = 20
  const offset = (page - 1) * limit

  let query = supabase
    .from('investment_transactions')
    .select('*, savings_goals(goal_name)', { count: 'exact' })
    .eq('user_id', user.id)
    .order('investment_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (asset_type && ASSET_TYPES.includes(asset_type as typeof ASSET_TYPES[number])) {
    query = query.eq('asset_type', asset_type)
  }
  if (from_date) query = query.gte('investment_date', from_date)
  if (to_date) query = query.lte('investment_date', to_date)
  if (goal_id) query = query.eq('goal_id', goal_id)
  if (unassigned === 'true') query = query.is('goal_id', null)

  const { data: transactions, error, count } = await query

  if (error) return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 })
  return NextResponse.json({ transactions, total: count ?? 0, page, limit })
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { goal_id, asset_type, investment_date, amount_vnd, unit_price, units, interest_rate, notes } = body

  if (!asset_type || !ASSET_TYPES.includes(asset_type)) {
    return NextResponse.json({ error: 'Invalid asset type.' }, { status: 400 })
  }
  if (!investment_date) {
    return NextResponse.json({ error: 'Investment date is required.' }, { status: 400 })
  }
  if (new Date(investment_date) > new Date()) {
    return NextResponse.json({ error: 'Investment date cannot be in the future.' }, { status: 400 })
  }
  const amountNum = Number(amount_vnd)
  if (!amount_vnd || isNaN(amountNum) || amountNum <= 0) {
    return NextResponse.json({ error: 'Amount must be greater than 0.' }, { status: 400 })
  }

  // Verify goal ownership if provided
  if (goal_id) {
    const { data: goal } = await supabase
      .from('savings_goals')
      .select('goal_id')
      .eq('goal_id', goal_id)
      .eq('user_id', user.id)
      .single()
    if (!goal) return NextResponse.json({ error: "You don't have permission to access this goal." }, { status: 403 })
  }

  const { data: transaction, error } = await supabase
    .from('investment_transactions')
    .insert({
      user_id: user.id,
      goal_id: goal_id || null,
      asset_type,
      investment_date,
      amount_vnd: amountNum,
      unit_price: unit_price ? Number(unit_price) : null,
      units: units ? Number(units) : null,
      interest_rate: interest_rate ? Number(interest_rate) : null,
      notes: notes?.trim() || null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Failed to create transaction' }, { status: 500 })
  return NextResponse.json(transaction, { status: 201 })
}
