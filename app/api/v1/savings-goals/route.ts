import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function calcProjectedInterest(amount: number, rate: number | null, investmentDate: string): number {
  if (!rate) return 0
  const months = Math.max(0, Math.floor(
    (Date.now() - new Date(investmentDate).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
  ))
  return amount * Math.pow(1 + rate / 100 / 12, months) - amount
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const withStats = searchParams.get('stats') === 'true'

  const { data: goals, error } = await supabase
    .from('savings_goals')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Failed to fetch goals' }, { status: 500 })

  if (!withStats) return NextResponse.json({ goals })

  // Fetch transactions with fund NAV in parallel with goals already done
  const { data: transactions, error: txError } = await supabase
    .from('investment_transactions')
    .select('transaction_id, goal_id, asset_type, amount_vnd, units, unit_price, interest_rate, investment_date, funds(id, name, nav)')
    .eq('user_id', user.id)
    .not('goal_id', 'is', null)

  if (txError) return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 })

  type TxRow = {
    transaction_id: string
    goal_id: string | null
    asset_type: string
    amount_vnd: number
    units: number | null
    unit_price: number | null
    interest_rate: number | null
    investment_date: string
    funds?: { id: string; name: string; nav: number } | { id: string; name: string; nav: number }[] | null
  }

  const statsMap = new Map<string, { count: number; invested: number; interest: number }>()
  ;(transactions as TxRow[]).forEach((tx) => {
    if (!tx.goal_id) return
    let gain: number
    if (tx.asset_type === 'fund' && tx.units) {
      const fund = Array.isArray(tx.funds) ? tx.funds[0] : tx.funds
      const currentNav = fund?.nav ?? tx.unit_price ?? 0
      gain = tx.units * currentNav - tx.amount_vnd
    } else {
      gain = calcProjectedInterest(tx.amount_vnd, tx.interest_rate, tx.investment_date)
    }
    const existing = statsMap.get(tx.goal_id) ?? { count: 0, invested: 0, interest: 0 }
    statsMap.set(tx.goal_id, { count: existing.count + 1, invested: existing.invested + tx.amount_vnd, interest: existing.interest + gain })
  })

  const goalsWithStats = (goals ?? []).map((g) => {
    const stats = statsMap.get(g.goal_id) ?? { count: 0, invested: 0, interest: 0 }
    return { ...g, transactionCount: stats.count, totalInvested: stats.invested, projectedInterest: stats.interest }
  })

  return NextResponse.json({ goals: goalsWithStats })
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { goal_name, description, target_amount } = body

  if (!goal_name || typeof goal_name !== 'string' || goal_name.trim().length === 0) {
    return NextResponse.json({ error: 'Goal name is required.' }, { status: 400 })
  }

  const targetAmountVal = target_amount != null && target_amount !== '' ? Number(target_amount) : null
  if (targetAmountVal !== null && (isNaN(targetAmountVal) || targetAmountVal <= 0)) {
    return NextResponse.json({ error: 'Goal amount must be a positive number.' }, { status: 400 })
  }

  const { data: goal, error } = await supabase
    .from('savings_goals')
    .insert({ user_id: user.id, goal_name: goal_name.trim(), description: description?.trim() || null, target_amount: targetAmountVal })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Goal name already exists' }, { status: 409 })
    return NextResponse.json({ error: 'Failed to create goal' }, { status: 500 })
  }

  return NextResponse.json(goal, { status: 201 })
}
