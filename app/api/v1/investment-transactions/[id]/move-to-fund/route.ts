import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateDate, validateUUID } from '@/lib/validation'
import { readJsonBody } from '@/lib/apiBody'
import { completedGoalError } from '@/lib/assertOwned'

// Move a matured term deposit into a fund — its target fund, in the sheet —
// instead of renewing it.
//
// Two writes that must land together: a withdrawal closing the deposit, and a
// purchase of the fund with the same money, filed under the deposit's goal.
// Done as two requests, a failure between them leaves the goal short or long by
// the whole deposit. So it is one call to move_deposit_to_fund
// (20261001000001), which also derives the principal being closed, checks the
// deposit has matured and the fund is the user's, and links the pair so that
// undoing the move (deleting the purchase) restores the deposit whole.
//
// The units are priced at the NAV the app knows; the purchase is flagged as
// estimated until the user corrects it to the NAV the order filled at.
const MOVE_PREFIX = 'move to fund: '

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const { received_vnd, fund_id, units, unit_price, date } = parsed.body

  let depositId: string
  let received: number
  let fundId: string
  let cleanUnits: number
  let nav: number
  let cleanDate: string | null = null
  try {
    depositId = validateUUID(id, 'transaction_id')
    received = Math.round(validateAmount(received_vnd, 'received_vnd'))
    if (received <= 0) throw new ValidationError('received_vnd must be positive')
    fundId = validateUUID(fund_id, 'fund_id')
    cleanUnits = validateAmount(units, 'units')
    if (cleanUnits <= 0) throw new ValidationError('units must be positive')
    nav = validateAmount(unit_price, 'unit_price')
    if (nav <= 0) throw new ValidationError('unit_price must be positive')
    if (date != null && date !== '') cleanDate = validateDate(date, 'date')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const { data, error } = await supabase.rpc('move_deposit_to_fund', {
    p_deposit_id: depositId,
    p_received_vnd: received,
    p_fund_id: fundId,
    p_units: cleanUnits,
    p_unit_price: nav,
    // Null lets the function date it on the business day (Asia/Ho_Chi_Minh).
    p_date: cleanDate,
  })

  if (error || !data) {
    const done = completedGoalError(error)
    if (done) return done
    const message: string = error?.message ?? ''
    if (message.startsWith(MOVE_PREFIX)) {
      const reason = message.slice(MOVE_PREFIX.length)
      // RLS hides another user's deposit, so "not found" is also the answer
      // for a deposit that is not the caller's — on purpose.
      if (error?.code === 'P0002') return NextResponse.json({ error: reason }, { status: 404 })
      if (error?.code === '42501') return NextResponse.json({ error: reason }, { status: 403 })
      return NextResponse.json({ error: reason, code: 'move_refused' }, { status: 400 })
    }
    console.error('move-to-fund: atomic move failed', message)
    return NextResponse.json({ error: 'Failed to move the deposit to the fund' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
