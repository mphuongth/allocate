import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateDate, validateUUID } from '@/lib/validation'
import { BULK_MAX_BODY_BYTES, readJsonBody } from '@/lib/apiBody'

interface BatchTransaction {
  fund_id: string
  investment_date: string
  amount_vnd: number
  unit_price: number
  units: number
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 500 rows is a legitimate body here, so this route opts out of the default
  // limit — see BULK_MAX_BODY_BYTES for the arithmetic.
  const parsed = await readJsonBody(request, { maxBytes: BULK_MAX_BODY_BYTES })
  if (!parsed.ok) return parsed.response
  const body = parsed.body
  const { transactions } = body as { transactions: BatchTransaction[] }

  if (!Array.isArray(transactions) || transactions.length === 0) {
    return NextResponse.json({ error: 'transactions must be a non-empty array.' }, { status: 400 })
  }
  if (transactions.length > 500) {
    return NextResponse.json({ error: 'Cannot import more than 500 transactions at once.' }, { status: 400 })
  }

  // Validate each row and collect errors
  const errors: { index: number; message: string }[] = []
  const validRows: { user_id: string; asset_type: string; fund_id: string; investment_date: string; amount_vnd: number; unit_price: number; units: number }[] = []

  transactions.forEach((tx, i) => {
    try {
      const fundId = validateUUID(tx.fund_id, 'fund_id')
      const investmentDate = validateDate(tx.investment_date, 'investment_date')
      const amount = validateAmount(tx.amount_vnd, 'amount_vnd')
      if (amount <= 0) throw new ValidationError('amount_vnd must be > 0')
      const unitPrice = validateAmount(tx.unit_price, 'unit_price')
      if (unitPrice <= 0) throw new ValidationError('unit_price must be > 0')
      const units = validateAmount(tx.units, 'units')
      if (units <= 0) throw new ValidationError('units must be > 0')

      validRows.push({
        user_id: user.id,
        asset_type: 'fund',
        fund_id: fundId,
        investment_date: investmentDate,
        amount_vnd: amount,
        unit_price: unitPrice,
        units: units,
      })
    } catch (e) {
      if (e instanceof ValidationError) {
        errors.push({ index: i, message: e.message })
      } else {
        throw e
      }
    }
  })

  // Verify all fund_ids belong to the user (only ones that passed UUID validation)
  const fundIds = [...new Set(validRows.map((t) => t.fund_id))]
  if (fundIds.length > 0) {
    const { data: userFunds } = await supabase
      .from('funds')
      .select('id')
      .eq('user_id', user.id)
      .in('id', fundIds)

    const validFundIds = new Set((userFunds ?? []).map((f: { id: string }) => f.id))
    const invalidFunds = fundIds.filter((id) => !validFundIds.has(id))
    if (invalidFunds.length > 0) {
      return NextResponse.json({ error: 'One or more fund IDs are invalid or do not belong to you.' }, { status: 403 })
    }
  }

  if (validRows.length === 0) {
    return NextResponse.json({ inserted: 0, errors }, { status: 400 })
  }

  const { error } = await supabase.from('investment_transactions').insert(validRows)
  if (error) return NextResponse.json({ error: 'Failed to insert transactions' }, { status: 500 })

  return NextResponse.json({ inserted: validRows.length, errors }, { status: 201 })
}
