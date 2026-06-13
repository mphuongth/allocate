import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateDate, validateEnum, validateNotes, validateRate, validateUUID } from '@/lib/validation'

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
  const plan_id = searchParams.get('plan_id')
  const unassigned = searchParams.get('unassigned')
  // Renewal history snapshots are excluded by default (so Recent Activity and
  // any future consumer stay clean); the goal-detail History tab opts in.
  const includeHistory = searchParams.get('include_history') === 'true'
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limitParam = parseInt(searchParams.get('limit') ?? '20', 10)
  const limit = Math.min(Math.max(1, isNaN(limitParam) ? 20 : limitParam), 1000)
  const offset = (page - 1) * limit

  let query = supabase
    .from('investment_transactions')
    .select('transaction_id, goal_id, asset_type, transaction_type, parent_transaction_id, renewed_from_transaction_id, interest_earned_vnd, investment_date, amount_vnd, unit_price, units, interest_rate, expiry_date, notes, fund_id, principal_withdrawn, units_withdrawn, affects_progress, savings_goals(goal_name), funds(id, name, nav)', { count: 'exact' })
    .eq('user_id', user.id)
    .order('investment_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (!includeHistory) query = query.is('renewed_from_transaction_id', null)
  if (asset_type && ASSET_TYPES.includes(asset_type as typeof ASSET_TYPES[number])) {
    query = query.eq('asset_type', asset_type)
  }
  if (from_date) query = query.gte('investment_date', from_date)
  if (to_date) query = query.lte('investment_date', to_date)
  if (goal_id) query = query.eq('goal_id', goal_id)
  if (plan_id) query = query.eq('plan_id', plan_id)
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
  const { goal_id, asset_type, transaction_type = 'investment', investment_date, amount_vnd, unit_price, units, interest_rate, notes, fund_id, plan_id, expiry_date, parent_transaction_id, principal_withdrawn, units_withdrawn, affects_progress } = body

  const isWithdrawal = transaction_type === 'withdrawal'

  let cleanTxType: 'investment' | 'withdrawal'
  let cleanAssetType: typeof ASSET_TYPES[number] | null = null
  let cleanInvestmentDate: string
  let cleanAmount: number
  let cleanUnitPrice: number | null = null
  let cleanUnits: number | null = null
  let cleanInterestRate: number | null = null
  let cleanNotes: string | null = null
  let cleanGoalId: string | null = null
  let cleanFundId: string | null = null
  let cleanPlanId: string | null = null
  let cleanExpiryDate: string | null = null
  let cleanParentTxId: string | null = null
  let cleanPrincipalWithdrawn: number | null = null
  let cleanUnitsWithdrawn: number | null = null

  try {
    cleanTxType = validateEnum(transaction_type, ['investment', 'withdrawal'] as const, 'transaction_type')

    if (!isWithdrawal) {
      cleanAssetType = validateEnum(asset_type, ASSET_TYPES, 'asset_type')
      if (cleanAssetType === 'fund' && !fund_id) {
        throw new ValidationError('fund_id is required for fund transactions')
      }
    } else if (asset_type) {
      cleanAssetType = validateEnum(asset_type, ASSET_TYPES, 'asset_type')
    }

    cleanInvestmentDate = validateDate(investment_date, 'investment_date')
    cleanAmount = validateAmount(amount_vnd, 'amount_vnd')
    if (cleanAmount <= 0) throw new ValidationError('amount_vnd must be positive')

    if (unit_price != null && unit_price !== '') cleanUnitPrice = validateAmount(unit_price, 'unit_price')
    if (units != null && units !== '') cleanUnits = validateAmount(units, 'units')
    if (interest_rate != null && interest_rate !== '') cleanInterestRate = validateRate(interest_rate, 'interest_rate')
    cleanNotes = validateNotes(notes)
    if (goal_id) cleanGoalId = validateUUID(goal_id, 'goal_id')
    if (fund_id) cleanFundId = validateUUID(fund_id, 'fund_id')
    if (plan_id) cleanPlanId = validateUUID(plan_id, 'plan_id')
    if (expiry_date) cleanExpiryDate = validateDate(expiry_date, 'expiry_date')
    if (parent_transaction_id) cleanParentTxId = validateUUID(parent_transaction_id, 'parent_transaction_id')
    if (principal_withdrawn != null && principal_withdrawn !== '') cleanPrincipalWithdrawn = validateAmount(principal_withdrawn, 'principal_withdrawn')
    if (units_withdrawn != null && units_withdrawn !== '') cleanUnitsWithdrawn = validateAmount(units_withdrawn, 'units_withdrawn')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  // Allow future dates within the plan month (plan_id provided); otherwise reject future dates
  if (!cleanPlanId && new Date(cleanInvestmentDate) > new Date()) {
    return NextResponse.json({ error: 'Investment date cannot be in the future.' }, { status: 400 })
  }

  // Verify goal ownership if provided
  if (cleanGoalId) {
    const { data: goal } = await supabase
      .from('savings_goals')
      .select('goal_id')
      .eq('goal_id', cleanGoalId)
      .eq('user_id', user.id)
      .single()
    if (!goal) return NextResponse.json({ error: "You don't have permission to access this goal." }, { status: 403 })
  }

  // Verify plan ownership if provided
  if (cleanPlanId) {
    const { data: plan } = await supabase.from('monthly_plans').select('id').eq('id', cleanPlanId).eq('user_id', user.id).single()
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  }

  const { data: transaction, error } = await supabase
    .from('investment_transactions')
    .insert({
      user_id: user.id,
      goal_id: cleanGoalId,
      transaction_type: cleanTxType,
      asset_type: cleanAssetType,
      investment_date: cleanInvestmentDate,
      amount_vnd: cleanAmount,
      unit_price: cleanUnitPrice,
      units: cleanUnits,
      interest_rate: cleanInterestRate,
      notes: cleanNotes,
      fund_id: cleanAssetType === 'fund' ? cleanFundId : null,
      plan_id: cleanPlanId,
      expiry_date: cleanExpiryDate,
      parent_transaction_id: cleanParentTxId,
      principal_withdrawn: cleanPrincipalWithdrawn,
      units_withdrawn: cleanUnitsWithdrawn,
      affects_progress: isWithdrawal ? (affects_progress !== false) : true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Failed to create transaction' }, { status: 500 })
  return NextResponse.json(transaction, { status: 201 })
}
