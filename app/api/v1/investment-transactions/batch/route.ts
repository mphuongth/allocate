import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

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

  const body = await request.json()
  const { transactions } = body as { transactions: BatchTransaction[] }

  if (!Array.isArray(transactions) || transactions.length === 0) {
    return NextResponse.json({ error: 'transactions must be a non-empty array.' }, { status: 400 })
  }
  if (transactions.length > 500) {
    return NextResponse.json({ error: 'Cannot import more than 500 transactions at once.' }, { status: 400 })
  }

  // Verify all fund_ids belong to the user
  const fundIds = [...new Set(transactions.map((t) => t.fund_id))]
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

  // Validate each row and collect errors
  const errors: { index: number; message: string }[] = []
  const validRows: object[] = []

  transactions.forEach((tx, i) => {
    if (!tx.investment_date) { errors.push({ index: i, message: 'investment_date is required' }); return }
    if (!tx.amount_vnd || tx.amount_vnd <= 0) { errors.push({ index: i, message: 'amount_vnd must be > 0' }); return }
    if (!tx.unit_price || tx.unit_price <= 0) { errors.push({ index: i, message: 'unit_price must be > 0' }); return }
    if (!tx.units || tx.units <= 0) { errors.push({ index: i, message: 'units must be > 0' }); return }

    validRows.push({
      user_id: user.id,
      asset_type: 'fund',
      fund_id: tx.fund_id,
      investment_date: tx.investment_date,
      amount_vnd: tx.amount_vnd,
      unit_price: tx.unit_price,
      units: tx.units,
    })
  })

  if (validRows.length === 0) {
    return NextResponse.json({ inserted: 0, errors }, { status: 400 })
  }

  const { error } = await supabase.from('investment_transactions').insert(validRows)
  if (error) return NextResponse.json({ error: 'Failed to insert transactions' }, { status: 500 })

  return NextResponse.json({ inserted: validRows.length, errors }, { status: 201 })
}
