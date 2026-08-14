import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateBankCode, validateDate, validateEnum, validateNotes, validatePositiveIntParam, validateRate, validateUUID } from '@/lib/validation'
import { isFutureInvestmentDate } from '@/lib/dates'
import { classifyAccumulatingTopUp } from '@/lib/accumulatingTopUp'
import { readJsonBody } from '@/lib/apiBody'
import { contentionError } from '@/lib/contention'

const ASSET_TYPES = ['fund', 'bank', 'stock', 'gold'] as const

// Every refusal create_held_settlement authors carries this prefix. Matching on
// it is what separates OUR rules — which the caller can act on, so they are
// forwarded verbatim as a 400 — from anything else the database says, which is
// an internal fault and must not be echoed back (#588).
const HELD_REFUSAL_PREFIX = 'held settlement: '

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
  let idFilter: string[] | null = null
  try {
    const ids = searchParams.get('ids')
    if (ids) {
      const parts = ids.split(',').filter(Boolean)
      if (parts.length > 100) throw new ValidationError('ids accepts at most 100 transaction ids')
      idFilter = parts.map((v, i) => validateUUID(v, `ids[${i}]`))
    }
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
    .select('transaction_id, goal_id, asset_type, transaction_type, parent_transaction_id, renewed_from_transaction_id, deposit_group_id, interest_earned_vnd, investment_date, amount_vnd, unit_price, units, interest_rate, expiry_date, notes, fund_id, bank_code, currency, is_pledged, top_up_lock_days, successor_deposit_tx_id, merged_from_book_id, principal_withdrawn, units_withdrawn, affects_progress, held_for_merge, consumed_by_inv_id, merge_anchor_inv_id, savings_goals(goal_name), funds(id, name, nav)', { count: 'exact' })
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
  // `ids` fetches a named set in one round trip. Goal detail uses it to pull the
  // few book anchors that fell outside its page — a book's terms live on the
  // anchor, and a page of tranches knows none of them (#638). Capped, because
  // the point is one small request instead of one request per id.
  if (idFilter) query = query.in('transaction_id', idFilter)

  const { data: transactions, error, count } = await query

  if (error) return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 })
  return NextResponse.json({ transactions, total: count ?? 0, page, limit })
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body
  const { goal_id, asset_type, transaction_type = 'investment', investment_date, amount_vnd, unit_price, units, interest_rate, notes, fund_id, plan_id, expiry_date, parent_transaction_id, principal_withdrawn, units_withdrawn, affects_progress, accumulating, tops_up_deposit_id, bank_code, top_up_lock_days, held_for_merge, merge_target_goal_id, merge_anchor_inv_id } = body

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
  let cleanTopUpLockDays: number | null = null
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
    if (top_up_lock_days != null && top_up_lock_days !== '') {
      const lockDays = Number(top_up_lock_days)
      if (!Number.isInteger(lockDays) || lockDays < 0 || lockDays > 3650) throw new ValidationError('top_up_lock_days must be a whole number from 0 to 3650')
      cleanTopUpLockDays = lockDays
    }
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

  // ── held-for-merge settlement ("Để dành gộp") ───────────────────────────────
  //
  // This shape is NOT built from the body (#588). A held settlement closes a
  // deposit and parks its cash, and the dashboard adds that cash straight back
  // into net worth and the goal bar — so amount_vnd here IS net worth. Assembled
  // from client fields it could be backed by no deposit at all, or by one worth a
  // thousandth of the amount claimed; the withdrawal invariant bounds
  // principal_withdrawn but never a withdrawal's own amount_vnd.
  //
  // create_held_settlement takes the source and derives the rest from it — owner,
  // goal, asset type, direction, and the principal being closed — under a row
  // lock, which is also what stops two settlements consuming one deposit. The
  // route's job shrinks to naming the source and translating the refusals.
  if (cleanHeldForMerge) {
    if (!cleanParentTxId) {
      return NextResponse.json(
        { error: 'A held-for-merge settlement must name the deposit it closes.' },
        { status: 400 },
      )
    }

    const { data: settlement, error: heldErr } = await supabase
      .rpc('create_held_settlement', {
        p_source_id: cleanParentTxId,
        p_amount_vnd: cleanAmount,
        p_investment_date: cleanInvestmentDate,
        // null lets the RPC default the target to the source's own goal — "the
        // cash stays where the deposit was".
        p_merge_target_goal_id: cleanMergeTargetGoalId,
        p_merge_anchor_inv_id: cleanMergeAnchorInvId,
      })
      .single()

    if (heldErr || !settlement) {
      const message = heldErr?.message ?? ''
      if (message.startsWith(HELD_REFUSAL_PREFIX)) {
        // A rule the caller broke, not a fault: say which one.
        //   42501 — a goal or anchor belonging to someone else. The 403 every
        //           other cross-user reference in this API answers with (#474).
        //   P0002 — the source lookup came back empty: missing, or someone
        //           else's, which RLS renders as the same thing and which must
        //           stay indistinguishable.
        const status = heldErr?.code === '42501' ? 403 : heldErr?.code === 'P0002' ? 404 : 400
        return NextResponse.json(
          { error: message.slice(HELD_REFUSAL_PREFIX.length), code: 'held_settlement_rejected' },
          { status },
        )
      }
      console.error('create_held_settlement: failed', message)
      return NextResponse.json({ error: 'Failed to create the settlement' }, { status: 500 })
    }

    return NextResponse.json(settlement, { status: 201 })
  }

  // Withdrawals can't yet target an accumulating book: the withdrawal parents to
  // one row, so an amount exceeding that tranche's principal wouldn't spill to
  // the book's other tranches and net worth would under-subtract. Per-tranche
  // withdrawal is a later phase; until then, block it rather than mis-value.
  if (isWithdrawal && cleanParentTxId) {
    const { data: parent } = await supabase
      .from('investment_transactions')
      .select('deposit_group_id, asset_type')
      .eq('transaction_id', cleanParentTxId)
      .eq('user_id', user.id)
      .single()
    if (parent?.deposit_group_id) {
      return NextResponse.json({ error: 'Cannot withdraw from an accumulating book yet.' }, { status: 400 })
    }
    // The shape rules for a parent-backed withdrawal, checked here so a malformed
    // request gets a message naming the field rather than the invariant's refusal
    // (which the trigger still raises — this is the same rule stated earlier, not a
    // replacement). See the withdrawal decision table in the PR / migration header.
    //
    // No principal means nothing leaves the holding: lib/depositValuation subtracts
    // coalesce(principal_withdrawn, 0), so the deposit keeps its full value while
    // the row claims cash left.
    if (!cleanPrincipalWithdrawn || cleanPrincipalWithdrawn <= 0) {
      return NextResponse.json(
        { error: 'principal_withdrawn is required and must be positive for a withdrawal from a holding.' },
        { status: 400 },
      )
    }
    // Gold is valued by quantity, so a gold sale must move units too or the metal
    // stays in net worth while its cost basis drops.
    if (parent?.asset_type === 'gold' && (!cleanUnitsWithdrawn || cleanUnitsWithdrawn <= 0)) {
      return NextResponse.json(
        { error: 'units_withdrawn is required and must be positive for a gold sale.' },
        { status: 400 },
      )
    }
  }

  // A fund sale has no parent row: it draws on the (goal, fund) bucket, and it is a
  // QUANTITY — the units are what the cost basis is allocated from (lib/fundWithdrawal).
  if (isWithdrawal && cleanAssetType === 'fund' && cleanFundId
      && (!cleanUnitsWithdrawn || cleanUnitsWithdrawn <= 0)) {
    return NextResponse.json(
      { error: 'units_withdrawn is required and must be positive for a fund sale.' },
      { status: 400 },
    )
  }

  // Everything else must say what it draws on. The one exception is a
  // held-for-merge settlement whose source isn't recorded yet — the pool shape
  // #588 exists to fix — and it is an exception for THAT, so an ordinary
  // withdrawal cannot wear it to leave no holding behind. The DB says the same
  // thing and remains the backstop for writers that don't come through here.
  if (isWithdrawal && !cleanParentTxId && !(cleanAssetType === 'fund' && cleanFundId)
      && !cleanHeldForMerge) {
    return NextResponse.json(
      { error: 'A withdrawal must say what it draws on: a holding, or a fund.' },
      { status: 400 },
    )
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
      .select('asset_type, deposit_group_id, goal_id, expiry_date, bank_code, top_up_lock_days')
      .eq('transaction_id', cleanTopsUpId)
      .eq('user_id', user.id)
      .single()
    if (!anchor) return NextResponse.json({ error: 'Deposit to top up not found.' }, { status: 404 })
    if (anchor.asset_type !== 'bank' || !anchor.deposit_group_id) {
      return NextResponse.json({ error: 'Can only top up an accumulating bank deposit.' }, { status: 400 })
    }
    const eligibility = classifyAccumulatingTopUp({ topUpDate: cleanInvestmentDate, expiryDate: anchor.expiry_date, lockDays: anchor.top_up_lock_days ?? null })
    if (eligibility.status === 'matured') return NextResponse.json({ error: 'Cannot top up a deposit on or after its maturity date.' }, { status: 400 })
    if (eligibility.status === 'locked-near-maturity') return NextResponse.json({ error: `This deposit no longer accepts top-ups: ${eligibility.daysRemaining} days remain before maturity (its lock window is ${eligibility.lockDays} days).`, code: 'top_up_locked_near_maturity' }, { status: 400 })
    depositGroupId = anchor.deposit_group_id
    effectiveGoalId = anchor.goal_id            // the tranche belongs to the book's goal
    effectiveExpiry = anchor.expiry_date        // book maturity, copied down to every tranche
    effectiveAssetType = 'bank'
    effectiveBankCode = anchor.bank_code ?? null // tranche inherits the book's bank
    cleanTopUpLockDays = anchor.top_up_lock_days ?? null
  } else if (accumulating) {
    // New accumulating book: the anchor self-groups so deposit_group_id IS NOT
    // NULL ⇔ accumulating, and the anchor is the row whose group = its own id.
    explicitTxId = randomUUID()
    depositGroupId = explicitTxId
  }

  // (Net-worth safety for a held settlement — a resolvable, owned target goal —
  // now lives in create_held_settlement, which every held row goes through and
  // which returned above. Nothing reaching here is held.)

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
      top_up_lock_days: depositGroupId ? cleanTopUpLockDays : null,
      // The held-for-merge pool is created by create_held_settlement, never here
      // (#588). Written out rather than left to the column defaults so a body
      // carrying these fields cannot ride in on a row this path builds.
      held_for_merge: false,
      merge_target_goal_id: null,
      merge_anchor_inv_id: null,
    })
    .select()
    .single()

  if (error) {
    if (error.message?.startsWith('accumulating top-up: ')) {
      return NextResponse.json({ error: error.message.slice('accumulating top-up: '.length), code: 'top_up_locked_near_maturity' }, { status: 400 })
    }
    // The withdrawal invariant refused it (20260730000002). Every refusal it
    // raises carries this prefix, so the whole family maps to a 400 with one
    // match — listing the messages individually meant a new refusal fell through
    // as a 500, reporting an invalid request as a server fault. The prefix is
    // pinned by supabase/tests/withdrawal_balance.test.sql.
    if (error.message?.includes('withdrawal invariant:')) {
      // The one a real user can hit: a stale sheet, a retry, or a sell that lost a
      // race. Matching the book withdrawal's own answer for the same condition.
      if (error.message.includes('remaining balance')) {
        return NextResponse.json({ error: 'Withdrawal exceeds the remaining balance of this holding.' }, { status: 400 })
      }
      // The rest are shapes no client builds from the UI — a withdrawal attached
      // to nothing, half a fund sell, a negative amount. Still the caller's
      // problem, not the server's.
      return NextResponse.json({ error: 'This withdrawal does not match the holding it is drawn on.' }, { status: 400 })
    }
    // A withdrawal from a book tranche waits for the book's anchor in the
    // recurring-link unlinker, and a concurrent full close takes them the other
    // way round (#650). Nothing was written; the caller can just retry.
    const busy = contentionError(error, 'This holding was being changed at the same time. Nothing was saved — try again.', 'holding_busy')
    if (busy) return busy
    console.error('investment-transactions POST insert failed', error.message)
    return NextResponse.json({ error: 'Failed to create transaction' }, { status: 500 })
  }

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
