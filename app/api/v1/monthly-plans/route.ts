import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month')
  const year = searchParams.get('year')

  if (!month || !year) {
    return NextResponse.json({ error: 'month and year are required' }, { status: 400 })
  }

  const { data: plan, error } = await supabase
    .from('monthly_plans')
    .select('*')
    .eq('user_id', user.id)
    .eq('month', parseInt(month))
    .eq('year', parseInt(year))
    .maybeSingle()

  if (error) return NextResponse.json({ error: 'Failed to fetch plan' }, { status: 500 })
  if (!plan) return NextResponse.json({ error: 'Plan not found for this month' }, { status: 404 })

  if (searchParams.get('full') === 'true') {
    const [invRes, savRes, overridesRes, expRes, insRes, exclRes, insOverridesRes, goalsRes, fundsRes, otherExpRes] = await Promise.all([
      supabase
        .from('investment_transactions')
        .select('transaction_id, plan_id, fund_id, goal_id, amount_vnd, units, unit_price, investment_date, funds(name, nav), savings_goals(goal_name)')
        .eq('plan_id', plan.id).eq('asset_type', 'fund'),
      supabase
        .from('investment_transactions')
        .select('transaction_id, plan_id, goal_id, amount_vnd, interest_rate, expiry_date, investment_date, savings_goals(goal_name)')
        .eq('plan_id', plan.id).eq('asset_type', 'bank'),
      supabase
        .from('fixed_expense_overrides')
        .select('fixed_expense_id, monthly_amount_override_vnd').eq('plan_id', plan.id),
      supabase
        .from('fixed_expenses')
        .select('expense_id, expense_name, amount_vnd, category').eq('user_id', user.id),
      supabase
        .from('insurance_members')
        .select('member_id, member_name, relationship, coverage_type, annual_payment_vnd, payment_date, last_payment_date')
        .eq('user_id', user.id),
      supabase
        .from('plan_excluded_insurance_members')
        .select('member_id').eq('plan_id', plan.id),
      supabase
        .from('plan_insurance_member_overrides')
        .select('member_id, monthly_amount_override_vnd').eq('plan_id', plan.id),
      supabase
        .from('savings_goals')
        .select('goal_id, goal_name').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase
        .from('funds')
        .select('id, name, nav').eq('user_id', user.id).order('name', { ascending: true }),
      supabase
        .from('plan_other_expenses')
        .select('id, description, amount_vnd, created_at').eq('plan_id', plan.id).order('created_at', { ascending: true }),
    ])
    return NextResponse.json({
      ...plan,
      fund_investments:        invRes.data ?? [],
      direct_savings:          savRes.data ?? [],
      fixed_expense_overrides: overridesRes.data ?? [],
      fixed_expenses:          expRes.data ?? [],
      insurance_members:       insRes.data ?? [],
      excluded_insurance:      exclRes.data ?? [],
      insurance_overrides:     insOverridesRes.data ?? [],
      goals:                   goalsRes.data ?? [],
      funds:                   fundsRes.data ?? [],
      other_expenses:          otherExpRes.data ?? [],
    })
  }

  return NextResponse.json(plan)
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { month, year, salary_vnd } = body

  const monthNum = parseInt(month)
  const yearNum = parseInt(year)
  const salaryNum = Number(salary_vnd)

  if (!month || monthNum < 1 || monthNum > 12) {
    return NextResponse.json({ error: 'Month must be between 1 and 12' }, { status: 400 })
  }
  if (!year || yearNum < 2000) {
    return NextResponse.json({ error: 'Invalid year' }, { status: 400 })
  }
  if (!salary_vnd || isNaN(salaryNum) || salaryNum <= 0) {
    return NextResponse.json({ error: 'Salary must be positive' }, { status: 400 })
  }

  const { data: plan, error } = await supabase
    .from('monthly_plans')
    .insert({ user_id: user.id, month: monthNum, year: yearNum, salary_vnd: salaryNum })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A plan for this month already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create plan' }, { status: 500 })
  }

  return NextResponse.json(plan, { status: 201 })
}
