import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateEnum, validateText, validateYearMonth } from '@/lib/validation'
// Shared bank-deposit valuation (simple interest, capped at maturity) so the
// goals list matches the dashboard and goal detail.
import { calcProjectedInterest } from '@/lib/finance'
import { readJsonBody } from '@/lib/apiBody'

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
    // Snapshot-free view so renewal history rows can't reach per-goal stats.
    .from('active_investment_transactions')
    .select('transaction_id, goal_id, asset_type, transaction_type, amount_vnd, units, unit_price, interest_rate, investment_date, expiry_date, funds(id, name, nav)')
    .eq('user_id', user.id)
    .not('goal_id', 'is', null)
    .is('renewed_from_transaction_id', null) // defence; the active_* view already excludes snapshots

  if (txError) return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 })

  type TxRow = {
    transaction_id: string
    goal_id: string | null
    asset_type: string | null
    transaction_type: string
    amount_vnd: number
    units: number | null
    unit_price: number | null
    interest_rate: number | null
    investment_date: string
    expiry_date: string | null
    funds?: { id: string; name: string; nav: number } | { id: string; name: string; nav: number }[] | null
  }

  const statsMap = new Map<string, { count: number; invested: number; interest: number }>()
  ;(transactions as TxRow[]).forEach((tx) => {
    if (!tx.goal_id) return
    const existing = statsMap.get(tx.goal_id) ?? { count: 0, invested: 0, interest: 0 }
    if (tx.transaction_type === 'withdrawal') {
      statsMap.set(tx.goal_id, { count: existing.count, invested: existing.invested - tx.amount_vnd, interest: existing.interest })
      return
    }
    let gain: number
    if (tx.asset_type === 'fund' && tx.units) {
      const fund = Array.isArray(tx.funds) ? tx.funds[0] : tx.funds
      const currentNav = fund?.nav ?? tx.unit_price ?? 0
      gain = tx.units * currentNav - tx.amount_vnd
    } else {
      gain = calcProjectedInterest(tx.amount_vnd, tx.interest_rate, tx.investment_date, tx.expiry_date)
    }
    statsMap.set(tx.goal_id, { count: existing.count + 1, invested: existing.invested + tx.amount_vnd, interest: existing.interest + gain })
  })

  const goalsWithStats = (goals ?? []).map((g) => {
    const stats = statsMap.get(g.goal_id) ?? { count: 0, invested: 0, interest: 0 }
    const current_value = stats.invested + stats.interest
    const progress_percentage = g.target_amount && g.target_amount > 0
      ? Math.min(100, (current_value / g.target_amount) * 100)
      : null
    return { ...g, transactionCount: stats.count, totalInvested: stats.invested, projectedInterest: stats.interest, current_value, progress_percentage }
  })

  return NextResponse.json({ goals: goalsWithStats })
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body
  const { goal_name, description, target_amount, target_date, icon, priority } = body

  let cleanGoalName: string
  let cleanDescription: string | null = null
  let cleanTargetAmount: number | null = null
  let cleanTargetDate: string | null = null
  let cleanIcon: string = 'target'
  let cleanPriority: string = 'med'

  try {
    cleanGoalName = validateText(goal_name, 'goal_name')
    if (description != null && description !== '') {
      cleanDescription = validateText(description, 'description', { max: 1000 })
    }
    if (target_amount != null && target_amount !== '') {
      const amt = validateAmount(target_amount, 'target_amount')
      if (amt <= 0) throw new ValidationError('target_amount must be positive')
      cleanTargetAmount = amt
    }
    if (target_date) {
      cleanTargetDate = validateYearMonth(target_date, 'target_date')
    }
    if (icon != null && icon !== '') {
      cleanIcon = validateEnum(icon, ['mountains', 'home', 'shield', 'cart', 'target'] as const, 'icon')
    }
    if (priority != null && priority !== '') {
      cleanPriority = validateEnum(priority, ['low', 'med', 'high'] as const, 'priority')
    }
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const { data: goal, error } = await supabase
    .from('savings_goals')
    .insert({
      user_id: user.id,
      goal_name: cleanGoalName,
      description: cleanDescription,
      target_amount: cleanTargetAmount,
      target_date: cleanTargetDate,
      icon: cleanIcon,
      priority: cleanPriority,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Goal name already exists' }, { status: 409 })
    return NextResponse.json({ error: 'Failed to create goal' }, { status: 500 })
  }

  return NextResponse.json(goal, { status: 201 })
}
