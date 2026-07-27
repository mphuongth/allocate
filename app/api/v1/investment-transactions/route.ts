import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateBankCode, validateDate, validateEnum, validateNotes, validatePositiveIntParam, validateRate, validateUUID } from '@/lib/validation'
import { isFutureInvestmentDate } from '@/lib/dates'

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
  let page: number
  let limit: number
  try {
    // Only finite positive integers; garbage (page=abc) is a 400, not a NaN
    // range call. limit is clamped to the documented ceiling of 1000.
    page = validatePositiveIntParam(searchParams.get('page'), 'page', { fallback: 1 })
    limit = validatePositiveIntParam(searchParams.get('limit'), 'limit', { fallback: 20, max: 1000 })
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }
  const offset = (page - 1) * limit

  let query = supabase
    .from('investment_transactions')
    .select('transaction_id, goal_id, asset_type, transaction_type, parent_transaction_id, renewed_from_transaction_id, deposit_group_id, interest_earned_vnd, investment_date, amount_vnd, unit_price, units, interest_rate, expiry_date, notes, fund_id, bank_code, currency, is_pledged, principal_withdrawn, units_withdrawn, affects_progress, held_for_merge, consumed_by_inv_id, merge_anchor_inv_id, savings_goals(goal_name), funds(id, name, nav)', { count: 'exact' })
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
  const { goal_id, asset_type, transaction_type = 'investment', investment_date, amount_vnd, unit_price, units, interest_rate, notes, fund_id, plan_id, expiry_date, parent_transaction_id, principal_withdrawn, units_withdrawn, affects_progress, accumulating, tops_up_deposit_id, bank_code, held_for_merge, merge_target_goal_id, merge_anchor_inv_id } = body

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
  let cleanTopsUpId: string | null = null
  let cleanBankCode: string | null = null
  // "Ví chờ gộp": a settle-with-hold parks the closed deposit's cash for a future
  // merge. Only meaningful on a withdrawal; the target goal/anchor say where the
  // pool synthesizes the cash back to and which deposit it's waiting on.
  const cleanHeldForMerge = isWithdrawal && held_for_merge === true
  let cleanMergeTargetGoalId: string | null = null
  let cleanMergeAnchorInvId: string | null = null

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
    if (tops_up_deposit_id) cleanTopsUpId = validateUUID(tops_up_deposit_id, 'tops_up_deposit_id')
    if (bank_code != null && bank_code !== '') cleanBankCode = validateBankCode(bank_code, 'bank_code')
    if (cleanHeldForMerge) {
      if (merge_target_goal_id) cleanMergeTargetGoalId = validateUUID(merge_target_goal_id, 'merge_target_goal_id')
      if (merge_anchor_inv_id) cleanMergeAnchorInvId = validateUUID(merge_anchor_inv_id, 'merge_anchor_inv_id')
    }
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  // Allow future dates within the plan month (plan_id provided); otherwise reject future dates
  if (!cleanPlanId && isFutureInvestmentDate(cleanInvestmentDate)) {
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

  // Verify fund ownership if provided — a valid UUID isn't proof of ownership,
  // so a known foreign fund_id can't be linked to this user's transaction (#474).
  if (cleanFundId) {
    const { data: fund } = await supabase
      .from('funds')
      .select('id')
      .eq('id', cleanFundId)
      .eq('user_id', user.id)
      .single()
    if (!fund) return NextResponse.json({ error: "You don't have permission to access this fund." }, { status: 403 })
  }

  // Same for caller-supplied transaction references — a foreign parent/merge
  // anchor UUID must not be linkable to this user's row (#474). The DB trigger is
  // the backstop; this returns a clean 403 instead of a constraint error.
  for (const refId of [cleanParentTxId, cleanMergeAnchorInvId]) {
    if (refId) {
      const { data: ref } = await supabase
        .from('investment_transactions')
        .select('transaction_id')
        .eq('transaction_id', refId)
        .eq('user_id', user.id)
        .single()
      if (!ref) return NextResponse.json({ error: "You don't have permission to access this transaction." }, { status: 403 })
    }
  }

  // Verify plan ownership if provided
  if (cleanPlanId) {
    const { data: plan } = await supabase.from('monthly_plans').select('id').eq('id', cleanPlanId).eq('user_id', user.id).single()
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  }

  // Withdrawals can't yet target an accumulating book: the withdrawal parents to
  // one row, so an amount exceeding that tranche's principal wouldn't spill to
  // the book's other tranches and net worth would under-subtract. Per-tranche
  // withdrawal is a later phase; until then, block it rather than mis-value.
  if (isWithdrawal && cleanParentTxId) {
    const { data: parent } = await supabase
      .from('investment_transactions')
      .select('deposit_group_id')
      .eq('transaction_id', cleanParentTxId)
      .eq('user_id', user.id)
      .single()
    if (parent?.deposit_group_id) {
      return NextResponse.json({ error: 'Cannot withdraw from an accumulating book yet.' }, { status: 400 })
    }
  }

  // Accumulating ("Loại 2") books. A top-up joins an existing book; creating one
  // makes the anchor row self-group. The book's goal + maturity are book-level,
  // so a top-up inherits them (copied down) and the tranche just carries its own
  // amount/rate/date.
  let explicitTxId: string | undefined
  let depositGroupId: string | null = null
  let effectiveGoalId = cleanGoalId
  let effectiveExpiry = cleanExpiryDate
  let effectiveAssetType = cleanAssetType
  let effectiveBankCode = cleanBankCode
  if (cleanTopsUpId) {
    const { data: anchor } = await supabase
      .from('investment_transactions')
      .select('asset_type, deposit_group_id, goal_id, expiry_date, bank_code')
      .eq('transaction_id', cleanTopsUpId)
      .eq('user_id', user.id)
      .single()
    if (!anchor) return NextResponse.json({ error: 'Deposit to top up not found.' }, { status: 404 })
    if (anchor.asset_type !== 'bank' || !anchor.deposit_group_id) {
      return NextResponse.json({ error: 'Can only top up an accumulating bank deposit.' }, { status: 400 })
    }
    // A matured book is closed: a new tranche dated today would sit past the
    // book's maturity and accrue zero interest (capped at expiry) — i.e. money
    // silently into a dead book. Block it.
    if (anchor.expiry_date && anchor.expiry_date < new Date().toISOString().slice(0, 10)) {
      return NextResponse.json({ error: 'Cannot top up a deposit that has already matured.' }, { status: 400 })
    }
    depositGroupId = anchor.deposit_group_id
    effectiveGoalId = anchor.goal_id            // the tranche belongs to the book's goal
    effectiveExpiry = anchor.expiry_date        // book maturity, copied down to every tranche
    effectiveAssetType = 'bank'
    effectiveBankCode = anchor.bank_code ?? null // tranche inherits the book's bank
  } else if (accumulating) {
    // New accumulating book: the anchor self-groups so deposit_group_id IS NOT
    // NULL ⇔ accumulating, and the anchor is the row whose group = its own id.
    explicitTxId = randomUUID()
    depositGroupId = explicitTxId
  }

  // Net-worth safety for a held settlement. A held withdrawal removes its source
  // from net worth, and the dashboard synthesizes the parked cash back ONLY via
  // merge_target_goal_id. If that can't be resolved — an unassigned deposit
  // settled with no explicit target — the cash leaves net worth and is never
  // added back: money silently lost, surfaced nowhere. The UI always supplies a
  // goal, so reject the unguarded API path rather than mis-state total assets.
  const resolvedHeldTargetGoalId = cleanMergeTargetGoalId ?? effectiveGoalId
  if (cleanHeldForMerge && !resolvedHeldTargetGoalId) {
    return NextResponse.json({ error: 'A held-for-merge settlement must resolve a target goal.' }, { status: 400 })
  }
  // The held target goal is an app-managed goal reference (no physical FK), so a
  // caller-supplied merge_target_goal_id must be verified for ownership too — a
  // foreign target would strand the parked cash in another user's goal (#474).
  if (cleanHeldForMerge && resolvedHeldTargetGoalId) {
    const { data: goal } = await supabase
      .from('savings_goals')
      .select('goal_id')
      .eq('goal_id', resolvedHeldTargetGoalId)
      .eq('user_id', user.id)
      .single()
    if (!goal) return NextResponse.json({ error: "You don't have permission to access this goal." }, { status: 403 })
  }

  const { data: transaction, error } = await supabase
    .from('investment_transactions')
    .insert({
      ...(explicitTxId ? { transaction_id: explicitTxId } : {}),
      user_id: user.id,
      goal_id: effectiveGoalId,
      transaction_type: cleanTxType,
      asset_type: effectiveAssetType,
      investment_date: cleanInvestmentDate,
      amount_vnd: cleanAmount,
      unit_price: cleanUnitPrice,
      units: cleanUnits,
      interest_rate: cleanInterestRate,
      notes: cleanNotes,
      fund_id: effectiveAssetType === 'fund' ? cleanFundId : null,
      plan_id: cleanPlanId,
      expiry_date: effectiveExpiry,
      parent_transaction_id: cleanParentTxId,
      principal_withdrawn: cleanPrincipalWithdrawn,
      units_withdrawn: cleanUnitsWithdrawn,
      affects_progress: isWithdrawal ? (affects_progress !== false) : true,
      deposit_group_id: depositGroupId,
      // Structured bank only applies to bank deposits; funds/gold have no bank.
      // A top-up tranche inherits the book's bank (effectiveBankCode).
      bank_code: effectiveAssetType === 'bank' ? effectiveBankCode : null,
      // Held-for-merge pool flags (withdrawal only). The target goal defaults to
      // the withdrawal's own goal (= the closed source's goal) when not given.
      held_for_merge: cleanHeldForMerge,
      merge_target_goal_id: cleanHeldForMerge ? resolvedHeldTargetGoalId : null,
      merge_anchor_inv_id: cleanHeldForMerge ? cleanMergeAnchorInvId : null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Failed to create transaction' }, { status: 500 })

  // Holding a deposit for merge closes its source, so a recurring saving linked
  // to that source must be unlinked or it would keep topping up a settled
  // deposit. That now happens inside the insert above, via the
  // investment_transactions_hold_clears_link trigger (20260727000003).
  //
  // It used to be a second statement here whose result was discarded, so a
  // failed cleanup returned 201 with a dangling link (#531). Doing it in the
  // database makes the pair commit or roll back together — a failure surfaces as
  // the insert's own error and is handled above — and covers every writer rather
  // than only the code path that remembered to run it.
  return NextResponse.json(transaction, { status: 201 })
}
