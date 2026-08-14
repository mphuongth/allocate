import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateInteger } from '@/lib/validation'
import { readJsonBody } from '@/lib/apiBody'

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

  let monthNum: number
  let yearNum: number
  try {
    // Require the entire value to be a valid integer — parseInt('1abc') === 1
    // would otherwise silently match the wrong plan.
    monthNum = validateInteger(month, 'month', { min: 1, max: 12 })
    yearNum = validateInteger(year, 'year', { min: 2000, max: 9999 })
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const { data: plan, error } = await supabase
    .from('monthly_plans')
    .select('*')
    .eq('user_id', user.id)
    .eq('month', monthNum)
    .eq('year', yearNum)
    .maybeSingle()

  if (error) return NextResponse.json({ error: 'Failed to fetch plan' }, { status: 500 })
  if (!plan) return NextResponse.json({ error: 'Plan not found for this month' }, { status: 404 })

  if (searchParams.get('full') === 'true') {
    // Auto-seed this plan's DCA rows and sync pending ones to the fund's current
    // amount/goal — atomically, before we read anything. Folding it into one RPC
    // (insert-on-conflict + update, in a single transaction) removes the old
    // read-then-insert race that let two concurrent loads create duplicate DCA
    // rows, and surfaces a failed write as a 500 instead of silently returning a
    // half-seeded plan. Because it runs first, the reads below see the result. (#466)
    const { error: seedError } = await supabase.rpc('seed_and_sync_plan_dca', { p_plan_id: plan.id })
    if (seedError) return NextResponse.json({ error: 'Failed to seed DCA entries' }, { status: 500 })

    const planDateForActive = `${plan.year}-${String(plan.month).padStart(2, '0')}-01`
    const ym = `${plan.year}-${String(plan.month).padStart(2, '0')}`
    const [invRes, savRes, overridesRes, expRes, insRes, exclRes, insOverridesRes, goalsRes, fundsRes, otherExpRes, recSavRes, recSavOverridesRes, dcaSkipsRes, recFulfillmentsRes] = await Promise.all([
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
        // Destinations for next month's savings, so a finished goal is not one:
        // it is an archive, and planning money into it would reopen a settled
        // result (#650). Rows already pointing at one still render their name
        // from their own `savings_goals(goal_name)` embed.
        .from('savings_goals')
        .select('goal_id, goal_name').eq('user_id', user.id)
        .is('completed_at', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('funds')
        .select('id, name, nav, is_dca, dca_monthly_amount_vnd, dca_goal_id').eq('user_id', user.id).order('name', { ascending: true }),
      supabase
        .from('plan_other_expenses')
        .select('id, description, amount_vnd, created_at').eq('plan_id', plan.id).order('created_at', { ascending: true }),
      supabase
        .from('recurring_savings')
        .select('saving_id, name, goal_id, amount_vnd, effective_from, effective_to, linked_deposit_tx_id, unlinked_at, unlinked_from_book, savings_goals(goal_name)')
        .eq('user_id', user.id)
        .or(`effective_from.is.null,effective_from.lte.${planDateForActive}`)
        .or(`effective_to.is.null,effective_to.gte.${planDateForActive}`),
      supabase
        .from('recurring_saving_overrides')
        .select('recurring_saving_id, monthly_amount_override_vnd').eq('plan_id', plan.id),
      supabase
        .from('plan_dca_skips')
        .select('fund_id').eq('plan_id', plan.id),
      // A recurring recorded via maturity-combine / book top-up writes a
      // fulfillment row instead of a plan-scoped deposit. The Plan page uses
      // these to mark such lines recorded and count them toward goal progress
      // (keyed by saving id, with the amount actually fulfilled this month).
      supabase
        .from('recurring_saving_fulfillments')
        .select('recurring_saving_id, amount_vnd, source').eq('user_id', user.id).eq('ym', ym),
    ])

    // Fail closed: every child query above feeds the plan the client renders.
    // Without this check a transient DB failure would fall through the
    // `data ?? []` defaults below and return HTTP 200 with real data missing —
    // indistinguishable from a genuinely empty plan (#514). Log which source(s)
    // failed for server-side diagnosis, but return a generic error to the client.
    const childErrors: [string, { message?: string } | null][] = [
      ['fund_investments', invRes.error],
      ['direct_savings', savRes.error],
      ['fixed_expense_overrides', overridesRes.error],
      ['fixed_expenses', expRes.error],
      ['insurance_members', insRes.error],
      ['excluded_insurance', exclRes.error],
      ['insurance_overrides', insOverridesRes.error],
      ['goals', goalsRes.error],
      ['funds', fundsRes.error],
      ['other_expenses', otherExpRes.error],
      ['recurring_savings', recSavRes.error],
      ['recurring_saving_overrides', recSavOverridesRes.error],
      ['dca_skips', dcaSkipsRes.error],
      ['recurring_fulfillments', recFulfillmentsRes.error],
    ]
    const failedSources = childErrors.filter(([, e]) => e).map(([name]) => name)
    if (failedSources.length > 0) {
      console.error(`[monthly-plans] plan ${plan.id}: child query failed for ${failedSources.join(', ')}`)
      return NextResponse.json({ error: 'Failed to fetch plan data' }, { status: 500 })
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
      recurring_savings:           recSavRes.data ?? [],
      recurring_saving_overrides:  recSavOverridesRes.data ?? [],
      dca_skips:                   dcaSkipsRes.data ?? [],
      recurring_fulfillments:      recFulfillmentsRes.data ?? [],
    })
  }

  return NextResponse.json(plan)
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body
  const { month, year, salary_vnd } = body

  let monthNum: number
  let yearNum: number
  let cleanSalary: number

  try {
    // Whole-integer parse rejects '1abc' etc.; range mirrors the GET handler.
    monthNum = validateInteger(month, 'month', { min: 1, max: 12 })
    yearNum = validateInteger(year, 'year', { min: 2000, max: 9999 })
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
