import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount } from '@/lib/validation'

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
        .select('transaction_id, plan_id, fund_id, goal_id, amount_vnd, units, unit_price, investment_date, is_dca_seeded, funds(name, nav), savings_goals(goal_name)')
        .eq('plan_id', plan.id).eq('asset_type', 'fund'),
      supabase
        .from('investment_transactions')
        .select('transaction_id, plan_id, goal_id, amount_vnd, interest_rate, expiry_date, investment_date, savings_goals(goal_name)')
        .eq('plan_id', plan.id).eq('asset_type', 'bank'),
      supabase
        .from('fixed_expense_overrides')
        .select('fixed_expense_id, monthly_amount_override_vnd').eq('plan_id', plan.id),
      (() => {
        const planDate = `${plan.year}-${String(plan.month).padStart(2, '0')}-01`
        return supabase
          .from('fixed_expenses')
          .select('expense_id, expense_name, amount_vnd, category, effective_from, effective_to')
          .eq('user_id', user.id)
          .or(`effective_from.is.null,effective_from.lte.${planDate}`)
          .or(`effective_to.is.null,effective_to.gte.${planDate}`)
      })(),
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
        .select('id, name, nav, is_dca, dca_monthly_amount_vnd').eq('user_id', user.id).order('name', { ascending: true }),
      supabase
        .from('plan_other_expenses')
        .select('id, description, amount_vnd, created_at').eq('plan_id', plan.id).order('created_at', { ascending: true }),
    ])
    // Auto-seed DCA fund entries and keep pending rows in sync with current DCA amount
    const allFunds = fundsRes.data ?? []
    const dcaFunds = allFunds.filter((f) => f.is_dca && f.dca_monthly_amount_vnd)
    const existingInvestments = invRes.data ?? []

    // Insert rows for DCA funds that have no entry yet for this plan
    const existingFundIds = new Set(existingInvestments.map((i) => i.fund_id))
    const missingDca = dcaFunds.filter((f) => !existingFundIds.has(f.id))
    if (missingDca.length > 0) {
      const firstOfMonth = `${plan.year}-${String(plan.month).padStart(2, '0')}-01`
      await supabase.from('investment_transactions').insert(
        missingDca.map((f) => ({
          user_id: user.id,
          plan_id: plan.id,
          fund_id: f.id,
          asset_type: 'fund',
          amount_vnd: f.dca_monthly_amount_vnd,
          units: null,
          unit_price: null,
          investment_date: firstOfMonth,
          is_dca_seeded: true,
        }))
      )
    }

    // Update pending DCA rows whose amount no longer matches the fund's current DCA setting
    // (happens when DCA is toggled off→on with a new amount)
    const staleRows = existingInvestments.filter((inv) => {
      if (!inv.is_dca_seeded || inv.units !== null) return false
      const fund = dcaFunds.find((f) => f.id === inv.fund_id)
      return fund && fund.dca_monthly_amount_vnd !== inv.amount_vnd
    })
    if (staleRows.length > 0) {
      await Promise.all(
        staleRows.map((inv) => {
          const fund = dcaFunds.find((f) => f.id === inv.fund_id)!
          return supabase
            .from('investment_transactions')
            .update({ amount_vnd: fund.dca_monthly_amount_vnd })
            .eq('transaction_id', inv.transaction_id)
        })
      )
    }

    if (missingDca.length > 0 || staleRows.length > 0) {
      const { data: refreshed } = await supabase
        .from('investment_transactions')
        .select('transaction_id, plan_id, fund_id, goal_id, amount_vnd, units, unit_price, investment_date, is_dca_seeded, funds(name, nav), savings_goals(goal_name)')
        .eq('plan_id', plan.id).eq('asset_type', 'fund')
      invRes.data = refreshed
    }

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

  let monthNum: number
  let yearNum: number
  let cleanSalary: number

  try {
    monthNum = parseInt(month)
    yearNum = parseInt(year)
    if (!month || !Number.isFinite(monthNum) || monthNum < 1 || monthNum > 12) {
      throw new ValidationError('Month must be between 1 and 12')
    }
    if (!year || !Number.isFinite(yearNum) || yearNum < 2000 || yearNum > 9999) {
      throw new ValidationError('Invalid year')
    }
    cleanSalary = validateAmount(salary_vnd, 'salary_vnd')
    if (cleanSalary <= 0) throw new ValidationError('Salary must be positive')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const { data: plan, error } = await supabase
    .from('monthly_plans')
    .insert({ user_id: user.id, month: monthNum, year: yearNum, salary_vnd: cleanSalary })
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
