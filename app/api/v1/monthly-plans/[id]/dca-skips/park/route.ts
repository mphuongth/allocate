import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateBankCode, validateDate, validateNotes, validateRate, validateUUID } from '@/lib/validation'
import { readJsonBody } from '@/lib/apiBody'
import { completedGoalError } from '@/lib/assertOwned'

// Park this month's DCA for a fund in a term deposit instead of buying it.
//
// One call to park_dca_in_deposit (20261002000002): the deposit (this plan's
// month, the DCA's goal, the DCA fund as its target), the pending seed
// removed, and a skip naming the deposit — together, or none of them. Undo is
// deleting the deposit, which takes the skip with it.
const PREFIX = 'park dca: '

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const { fund_id, amount_vnd, interest_rate, investment_date, expiry_date, bank_code, notes } = parsed.body

  let args: Record<string, unknown>
  try {
    const amount = Math.round(validateAmount(amount_vnd, 'amount_vnd'))
    if (amount <= 0) throw new ValidationError('amount_vnd must be positive')
    if (interest_rate == null || interest_rate === '') throw new ValidationError('interest_rate is required')
    const rate = validateRate(interest_rate, 'interest_rate')
    if (rate <= 0) throw new ValidationError('interest_rate must be positive')
    if (!expiry_date) throw new ValidationError('expiry_date is required')
    args = {
      p_plan_id: validateUUID(id, 'plan_id'),
      p_fund_id: validateUUID(fund_id, 'fund_id'),
      p_amount_vnd: amount,
      p_interest_rate: rate,
      p_investment_date: validateDate(investment_date, 'investment_date'),
      p_expiry_date: validateDate(expiry_date, 'expiry_date'),
      p_bank_code: bank_code != null && bank_code !== '' ? validateBankCode(bank_code, 'bank_code') : null,
      p_notes: notes != null && notes !== '' ? validateNotes(notes) : null,
    }
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const { data, error } = await supabase.rpc('park_dca_in_deposit', args)
  if (error || !data) {
    const done = completedGoalError(error)
    if (done) return done
    const message: string = error?.message ?? ''
    if (message.startsWith(PREFIX)) {
      const reason = message.slice(PREFIX.length)
      if (error?.code === 'P0002') return NextResponse.json({ error: reason }, { status: 404 })
      if (error?.code === '42501') return NextResponse.json({ error: reason }, { status: 403 })
      return NextResponse.json({ error: reason, code: 'park_refused' }, { status: 400 })
    }
    console.error('park-dca: atomic park failed', message)
    return NextResponse.json({ error: 'Failed to park the DCA in a deposit' }, { status: 500 })
  }
  return NextResponse.json({ deposit_id: data }, { status: 201 })
}
