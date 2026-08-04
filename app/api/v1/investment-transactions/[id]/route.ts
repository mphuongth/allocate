import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateBankCode, validateDate, validateEnum, validateNotes, validateRate, validateUUID } from '@/lib/validation'
import { readJsonBody } from '@/lib/apiBody'
import { isFutureInvestmentDate } from '@/lib/dates'
import { subtypeResetFields } from '@/lib/assetTypeFields'

const ASSET_TYPES = ['fund', 'bank', 'stock', 'gold'] as const

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { data: transaction, error } = await supabase
    .from('investment_transactions')
    .select('*, savings_goals(goal_name)')
    .eq('transaction_id', txId)
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

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body
  const { goal_id, asset_type, investment_date, amount_vnd, unit_price, units, interest_rate, expiry_date, notes, fund_id, bank_code } = body

  let txId: string
  let cleanAssetType: typeof ASSET_TYPES[number] | undefined
  let cleanInvestmentDate: string | undefined
  let cleanAmount: number | undefined
  let cleanUnitPrice: number | null | undefined
  let cleanUnits: number | null | undefined
  let cleanInterestRate: number | null | undefined
  let cleanExpiryDate: string | null | undefined
  let cleanNotes: string | null | undefined
  let cleanGoalId: string | null | undefined
  let cleanFundId: string | null | undefined
  let cleanBankCode: string | null | undefined

  try {
    txId = validateUUID(id, 'transaction_id')

    if (asset_type !== undefined) {
      cleanAssetType = validateEnum(asset_type, ASSET_TYPES, 'asset_type')
    }
    if (cleanAssetType === 'fund' && fund_id === undefined) {
      throw new ValidationError('Fund selection is required for fund transactions.')
    }
    if (investment_date !== undefined && investment_date !== null && investment_date !== '') {
      cleanInvestmentDate = validateDate(investment_date, 'investment_date')
    }
    if (amount_vnd !== undefined) {
      const amt = validateAmount(amount_vnd, 'amount_vnd')
      if (amt <= 0) throw new ValidationError('Amount must be greater than 0.')
      cleanAmount = amt
    }
    if (unit_price !== undefined) {
      cleanUnitPrice = unit_price === null || unit_price === '' ? null : validateAmount(unit_price, 'unit_price')
    }
    if (units !== undefined) {
      cleanUnits = units === null || units === '' ? null : validateAmount(units, 'units')
    }
    if (interest_rate !== undefined) {
      cleanInterestRate = interest_rate === null || interest_rate === '' ? null : validateRate(interest_rate, 'interest_rate')
    }
    if (expiry_date !== undefined) {
      cleanExpiryDate = expiry_date === null || expiry_date === '' ? null : validateDate(expiry_date, 'expiry_date')
    }
    if (notes !== undefined) {
      cleanNotes = validateNotes(notes)
    }
    if (goal_id !== undefined) {
      cleanGoalId = goal_id === null || goal_id === '' ? null : validateUUID(goal_id, 'goal_id')
    }
    if (fund_id !== undefined) {
      cleanFundId = fund_id === null || fund_id === '' ? null : validateUUID(fund_id, 'fund_id')
    }
    if (bank_code !== undefined) {
      cleanBankCode = bank_code === null || bank_code === '' ? null : validateBankCode(bank_code, 'bank_code')
    }
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  // The same business-day check POST uses. Comparing `new Date(date) > new Date()`
  // parsed the plain date at UTC midnight, so between 00:00 and 06:59 Vietnam time
  // an edit was refused for the very date creation had just accepted (#591).
  if (cleanInvestmentDate && isFutureInvestmentDate(cleanInvestmentDate)) {
    return NextResponse.json({ error: 'Investment date cannot be in the future.' }, { status: 400 })
  }

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

  // An accumulating book shares goal + maturity across all tranches. Editing it
  // must update the whole group atomically — doing the row update and the cascade
  // as two separate statements risks a partial failure that splits the book across
  // goals/maturities. Route a book through the single-transaction RPC, which
  // cascades the book-level fields to every tranche and applies tranche-level
  // fields to the edited row together. Non-book holdings use the generic path below.
  const { data: existing } = await supabase
    .from('investment_transactions')
    .select('deposit_group_id, asset_type')
    .eq('transaction_id', txId)
    .eq('user_id', user.id)
    .single()
  if (!existing) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })

  const changesAssetType = Boolean(cleanAssetType && existing.asset_type && cleanAssetType !== existing.asset_type)

  // A book is a group of bank tranches sharing a goal, a maturity and a bank.
  // Converting one row out of `bank` would leave its siblings describing a
  // deposit that no longer exists — and the book RPC has no asset_type argument,
  // so the change would silently do nothing. Refuse it instead (#593).
  if (existing.deposit_group_id && changesAssetType) {
    return NextResponse.json(
      { error: 'An accumulating deposit book cannot be changed to another asset type.', code: 'book_type_change' },
      { status: 400 },
    )
  }

  if (existing.deposit_group_id) {
    const { data: row, error: bookErr } = await supabase
      .rpc('update_deposit_book', {
        p_tx_id: txId,
        p_set_goal: goal_id !== undefined, p_goal_id: cleanGoalId ?? null,
        p_set_expiry: expiry_date !== undefined, p_expiry_date: cleanExpiryDate ?? null,
        p_set_amount: cleanAmount !== undefined, p_amount_vnd: cleanAmount ?? null,
        p_set_rate: interest_rate !== undefined, p_interest_rate: cleanInterestRate ?? null,
        p_set_investment: cleanInvestmentDate !== undefined, p_investment_date: cleanInvestmentDate ?? null,
        p_set_notes: notes !== undefined, p_notes: cleanNotes ?? null,
        // bank_code is book-level: the RPC cascades it to every tranche.
        p_set_bank: bank_code !== undefined, p_bank_code: cleanBankCode ?? null,
      })
      .single()
    if (bookErr || !row) {
      console.error('update_deposit_book: atomic book edit failed', bookErr?.message)
      return NextResponse.json({ error: 'Failed to update deposit book' }, { status: 500 })
    }
    return NextResponse.json(row)
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  // A type change drops the previous subtype's columns FIRST, so anything the
  // request restates for the new type overwrites the null below and anything it
  // omits is genuinely gone (#593). Without this the row kept contradictory
  // metadata — a "fund" holding still carrying a maturity and a bank code.
  if (changesAssetType && cleanAssetType) {
    Object.assign(updates, subtypeResetFields(existing.asset_type, cleanAssetType))
  }
  if (goal_id !== undefined) updates.goal_id = cleanGoalId
  if (cleanAssetType) updates.asset_type = cleanAssetType
  if (cleanInvestmentDate) updates.investment_date = cleanInvestmentDate
  if (cleanAmount !== undefined) updates.amount_vnd = cleanAmount
  if (unit_price !== undefined) updates.unit_price = cleanUnitPrice
  if (units !== undefined) updates.units = cleanUnits
  if (interest_rate !== undefined) updates.interest_rate = cleanInterestRate
  if (expiry_date !== undefined) updates.expiry_date = cleanExpiryDate
  if (notes !== undefined) updates.notes = cleanNotes
  if (fund_id !== undefined) updates.fund_id = cleanAssetType === 'fund' ? cleanFundId : null
  // Scope bank_code to bank deposits (mirror POST): a stray bank_code on a
  // fund/gold edit is forced to null. Effective type = the edit's asset_type if
  // provided, else the row's existing type.
  if (bank_code !== undefined) {
    const effType = cleanAssetType ?? existing.asset_type
    updates.bank_code = effType === 'bank' ? cleanBankCode : null
  }

  const { data: transaction, error } = await supabase
    .from('investment_transactions')
    .update(updates)
    .eq('transaction_id', txId)
    .eq('user_id', user.id)
    .select()
    .single()

  // A deposit that has already been settled for merge cannot have its amount or
  // goal changed: the settlement is a statement about that balance, and moving it
  // underneath would revive the deposit in net worth while its cash still sits in
  // the pool (#588). A conflict the user resolves — "Bỏ chờ gộp" removes the
  // settlement and restores the deposit — not a missing row, so 404 would
  // misdescribe it. The prefix marks a rule this codebase authored.
  // The book rules the table enforces (20260802000002). The guard above reads
  // deposit_group_id before the write, so a deposit that becomes a book in
  // between — a recurring top-up self-groups its anchor — is caught here
  // instead. It is the same refusal, and 404 would call it a missing row.
  if (error?.message?.startsWith('deposit book: ')) {
    return NextResponse.json(
      { error: 'An accumulating deposit book cannot be changed to another asset type.', code: 'book_type_change' },
      { status: 400 },
    )
  }

  if (error?.message?.startsWith('held settlement: ')) {
    return NextResponse.json(
      {
        error: 'A settlement is recorded against this deposit. Remove that settlement before changing it.',
        code: 'held_settlement_parked',
      },
      { status: 409 },
    )
  }

  // The withdrawal invariant refused the edit. An asset-type change can create the
  // shape a withdrawal may not wear — a holding becoming a fund purchase while a
  // withdrawal that is not keyed by a fund draws on it (#606) — and the row is
  // right there on screen, so 404 'not found' would describe it as something else
  // entirely. Matched on the family prefix, exactly as POST does, so a refusal
  // added later cannot fall through as the wrong status.
  if (error?.message?.includes('withdrawal invariant:')) {
    return NextResponse.json(
      {
        error: 'A withdrawal is recorded against this holding. Remove it before changing the holding this way.',
        code: 'withdrawal_invariant',
      },
      { status: 400 },
    )
  }

  if (error || !transaction) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })

  // (Accumulating books took the atomic update_deposit_book path above; only
  // non-book holdings reach here, so there's no goal/maturity cascade to do.)
  return NextResponse.json(transaction)
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

  // A merge folds a source's cash into the anchor's principal and closes the source
  // with a withdrawal stamped consumed_by_inv_id = the anchor. Deleting that
  // withdrawal would re-open the source at full value while its cash still sits in
  // the anchor → double-count. This applies to BOTH fold paths:
  //   • held ("Để dành gộp"): the held withdrawal, consumed when the merge runs;
  //   • live: the plain withdrawal the merge RPC opens for a sibling source.
  // Both carry consumed_by_inv_id, so the guard keys on that marker alone (not on
  // held_for_merge). The UI hides the affordances once consumed, but a stale tab or
  // the ledger's per-row delete (shown on every row) must not get through.
  //
  // The guard is the DELETE's own WHERE clause, not a SELECT before it (#526).
  // As two statements there was a window a merge could commit into, and the
  // SELECT's dropped error fell through to an unguarded DELETE. As one statement
  // there is nothing to race: a concurrent merge either commits first — Postgres
  // re-evaluates the predicate against the updated row and deletes nothing — or
  // finds the row already gone.
  const { data: deleted, error } = await supabase
    .from('investment_transactions')
    .delete()
    .eq('transaction_id', txId)
    .eq('user_id', user.id)
    .is('consumed_by_inv_id', null)
    .select('transaction_id')

  if (error) {
    // The deposit still has a settlement parked against it (#588). Deleting it
    // nulls the settlement's only link back to what it closed, and the deferred
    // source check refuses that at the end of the transaction — another conflict
    // the user resolves ("Bỏ chờ gộp" removes the settlement and restores the
    // deposit), not a fault. The prefix marks a rule this codebase authored;
    // anything else the database says is not quoted back.
    if (error.message?.startsWith('held settlement: ')) {
      return NextResponse.json(
        {
          error: 'A settlement is parked against this deposit. Remove that settlement before deleting it.',
          code: 'held_settlement_parked',
        },
        { status: 409 },
      )
    }
    // The mirror image of the guard above. Two columns reference this table with
    // no ON DELETE action, so deleting a deposit that either one points at raises
    // a foreign-key violation — a conflict the user can resolve, not a server
    // fault, so it must not read as a 500.
    //
    // The two need different remedies, which is why this doesn't collapse into
    // one message: consumed_by_inv_id means a merge already happened and must be
    // undone, while merge_anchor_inv_id is stamped when a settlement is HELD —
    // before any merge — so telling that caller to undo a merge sends them
    // looking for something that doesn't exist. Postgres names the violated
    // constraint in the error, which is where the distinction comes from.
    if (error.code === '23503') {
      const violation = `${error.message ?? ''} ${error.details ?? ''}`
      if (violation.includes('consumed_by_inv_id')) {
        return NextResponse.json(
          { error: 'Another settlement has been merged into this deposit, so it cannot be removed.', code: 'merge_target' },
          { status: 409 },
        )
      }
      if (violation.includes('merge_anchor_inv_id')) {
        return NextResponse.json(
          { error: 'A settlement is waiting to be merged into this deposit. Cancel that pending settlement before removing it.', code: 'settlement_pending' },
          { status: 409 },
        )
      }
      return NextResponse.json(
        { error: 'Another record still references this transaction. Remove that reference before deleting it.', code: 'referenced' },
        { status: 409 },
      )
    }
    console.error('investment-transactions delete: statement failed', error.message)
    return NextResponse.json({ error: 'Failed to delete transaction', code: 'delete_failed' }, { status: 500 })
  }
  if (deleted && deleted.length > 0) {
    return NextResponse.json({ message: 'Transaction deleted.' })
  }

  // Nothing matched: either the row is gone, or it survived the guard. Only a
  // read can tell those apart, and it runs strictly AFTER the delete — it can no
  // longer influence whether anything is removed.
  const { data: surviving, error: lookupErr } = await supabase
    .from('investment_transactions')
    .select('transaction_id')
    .eq('transaction_id', txId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (lookupErr) {
    // Don't guess: 404 would claim the settlement is gone when it may still be
    // there, and 409 would block a delete that legitimately found nothing.
    console.error('investment-transactions delete: could not classify a no-op delete', lookupErr.message)
    return NextResponse.json({ error: 'Failed to delete transaction', code: 'delete_failed' }, { status: 500 })
  }
  if (!surviving) return NextResponse.json({ error: 'Transaction not found', code: 'not_found' }, { status: 404 })

  // The row is still there, so the guard is what stopped the delete.
  return NextResponse.json(
    { error: 'This settlement is part of a completed merge, so it cannot be removed.', code: 'settlement_consumed' },
    { status: 409 },
  )
}
