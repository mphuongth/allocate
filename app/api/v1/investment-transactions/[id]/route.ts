import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateBankCode, validateDate, validateEnum, validateNotes, validateRate, validateUUID } from '@/lib/validation'

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

  const body = await request.json()
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

  if (cleanInvestmentDate && new Date(cleanInvestmentDate) > new Date()) {
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

  // An accumulating book shares goal + maturity across all tranches. Editing it
  // must update the whole group atomically — doing the row update and the cascade
  // as two separate statements risks a partial failure that splits the book across
  // goals/maturities. Route a book through the single-transaction RPC, which
  // cascades the book-level fields to every tranche and applies tranche-level
  // fields to the edited row together. Non-book holdings use the generic path below.
  const { data: existing } = await supabase
    .from('investment_transactions')
    .select('deposit_group_id')
    .eq('transaction_id', txId)
    .eq('user_id', user.id)
    .single()
  if (!existing) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })

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
      })
      .single()
    if (bookErr || !row) {
      console.error('update_deposit_book: atomic book edit failed', bookErr?.message)
      return NextResponse.json({ error: 'Failed to update deposit book' }, { status: 500 })
    }
    return NextResponse.json(row)
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
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
  if (bank_code !== undefined) updates.bank_code = cleanBankCode

  const { data: transaction, error } = await supabase
    .from('investment_transactions')
    .update(updates)
    .eq('transaction_id', txId)
    .eq('user_id', user.id)
    .select()
    .single()

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

  const { error } = await supabase
    .from('investment_transactions')
    .delete()
    .eq('transaction_id', txId)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  return NextResponse.json({ message: 'Transaction deleted.' })
}
