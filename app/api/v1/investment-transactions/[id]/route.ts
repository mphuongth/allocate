import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const ASSET_TYPES = ['fund', 'bank', 'stock', 'gold'] as const

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: transaction, error } = await supabase
    .from('investment_transactions')
    .select('*, savings_goals(goal_name)')
    .eq('transaction_id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !transaction) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  return NextResponse.json(transaction)
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { goal_id, asset_type, investment_date, amount_vnd, unit_price, units, interest_rate, notes, fund_id } = body

  if (asset_type && !ASSET_TYPES.includes(asset_type)) {
    return NextResponse.json({ error: 'Invalid asset type.' }, { status: 400 })
  }
  if (asset_type === 'fund' && fund_id === undefined) {
    return NextResponse.json({ error: 'Fund selection is required for fund transactions.' }, { status: 400 })
  }
  if (investment_date && new Date(investment_date) > new Date()) {
    return NextResponse.json({ error: 'Investment date cannot be in the future.' }, { status: 400 })
  }
  if (amount_vnd !== undefined && (isNaN(Number(amount_vnd)) || Number(amount_vnd) <= 0)) {
    return NextResponse.json({ error: 'Amount must be greater than 0.' }, { status: 400 })
  }

  if (goal_id) {
    const { data: goal } = await supabase
      .from('savings_goals')
      .select('goal_id')
      .eq('goal_id', goal_id)
      .eq('user_id', user.id)
      .single()
    if (!goal) return NextResponse.json({ error: "You don't have permission to access this goal." }, { status: 403 })
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (goal_id !== undefined) updates.goal_id = goal_id || null
  if (asset_type) updates.asset_type = asset_type
  if (investment_date) updates.investment_date = investment_date
  if (amount_vnd !== undefined) updates.amount_vnd = Number(amount_vnd)
  if (unit_price !== undefined) updates.unit_price = unit_price ? Number(unit_price) : null
  if (units !== undefined) updates.units = units ? Number(units) : null
  if (interest_rate !== undefined) updates.interest_rate = interest_rate ? Number(interest_rate) : null
  if (notes !== undefined) updates.notes = notes?.trim() || null
  if (fund_id !== undefined) updates.fund_id = asset_type === 'fund' ? (fund_id || null) : null

  const { data: transaction, error } = await supabase
    .from('investment_transactions')
    .update(updates)
    .eq('transaction_id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error || !transaction) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  return NextResponse.json(transaction)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('investment_transactions')
    .delete()
    .eq('transaction_id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  return NextResponse.json({ message: 'Transaction deleted.' })
}
