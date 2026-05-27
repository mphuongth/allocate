import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateDate, validateUUID } from '@/lib/validation'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { fund_id, goal_id, amount_vnd, units_purchased, nav_at_purchase, investment_date } = body

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  try {
    const txId = validateUUID(id, 'transaction_id')

    if (fund_id !== undefined) {
      updates.fund_id = fund_id === null || fund_id === '' ? null : validateUUID(fund_id, 'fund_id')
    }
    if (goal_id !== undefined) {
      updates.goal_id = goal_id === null || goal_id === '' ? null : validateUUID(goal_id, 'goal_id')
    }
    if (amount_vnd !== undefined) {
      const n = validateAmount(amount_vnd, 'amount_vnd')
      if (n <= 0) throw new ValidationError('Amount and units are required and must be positive')
      updates.amount_vnd = n
    }
    if (units_purchased !== undefined) {
      const n = validateAmount(units_purchased, 'units_purchased')
      if (n <= 0) throw new ValidationError('Amount and units are required and must be positive')
      updates.units = n
    }
    if (nav_at_purchase !== undefined) {
      const n = validateAmount(nav_at_purchase, 'nav_at_purchase')
      if (n <= 0) throw new ValidationError('NAV at purchase must be positive')
      updates.unit_price = n
    }
    if (investment_date !== undefined) {
      updates.investment_date = investment_date === null || investment_date === '' ? null : validateDate(investment_date, 'investment_date')
    }

    const { data, error } = await supabase
      .from('investment_transactions')
      .update(updates)
      .eq('transaction_id', txId)
      .eq('user_id', user.id)
      .select('transaction_id, fund_id, goal_id, amount_vnd, units, unit_price, investment_date, created_at, funds(name, nav), savings_goals(goal_name)')
      .single()

    if (error || !data) return NextResponse.json({ error: 'Investment not found' }, { status: 404 })

    return NextResponse.json({
      id: data.transaction_id,
      fund_id: data.fund_id,
      goal_id: data.goal_id,
      amount_vnd: data.amount_vnd,
      units_purchased: data.units,
      nav_at_purchase: data.unit_price,
      investment_date: data.investment_date,
      created_at: data.created_at,
      funds: data.funds,
      savings_goals: data.savings_goals,
    })
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let txId: string
  try {
    txId = validateUUID(id, 'transaction_id')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('investment_transactions')
    .delete()
    .eq('transaction_id', txId)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: 'Investment not found' }, { status: 404 })
  return new NextResponse(null, { status: 204 })
}
