import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateUUID, validateDate } from '@/lib/validation'

function err(status: number, code: string, message: string) {
  return NextResponse.json({ error: code, message }, { status })
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // 400 — UUID validation
  let memberId: string
  try {
    memberId = validateUUID(id, 'member_id')
  } catch (e) {
    if (e instanceof ValidationError) return err(400, 'INVALID_MEMBER_ID', 'Invalid member ID format')
    throw e
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err(401, 'UNAUTHORIZED', 'Authentication required')

  // Fetch member — distinguish 404 vs 403
  const { data: member, error: fetchError } = await supabase
    .from('insurance_members')
    .select('member_id, user_id, member_name, annual_payment_vnd, monthly_premium_vnd, payment_date, updated_at')
    .eq('member_id', memberId)
    .single()

  if (fetchError || !member) return err(404, 'NOT_FOUND', 'Insurance member not found')
  if (member.user_id !== user.id) return err(403, 'FORBIDDEN', "You don't have permission to mark this payment")

  // Optional payment date from the body — when the user records the payment on a
  // date other than today. Defaults to today when absent.
  const now = new Date()
  let paidISO = now.toISOString().split('T')[0]
  const body = await _req.json().catch(() => null)
  if (body && body.paid_date != null && body.paid_date !== '') {
    try {
      paidISO = validateDate(body.paid_date, 'paid_date')
    } catch (e) {
      if (e instanceof ValidationError) return err(400, 'INVALID_PAID_DATE', 'Invalid payment date')
      throw e
    }
  }

  // Advance payment_date by exactly 1 year (keep month/day, increment year)
  const nextPaymentDate = member.payment_date
    ? (() => {
        const d = new Date(member.payment_date)
        d.setFullYear(d.getFullYear() + 1)
        return d.toISOString().split('T')[0]
      })()
    : null

  // Savings history is preserved. Contributions made on/before this payment
  // funded the now-settled cycle; progress for the next cycle is computed from
  // contributions made after last_payment_date (see isInCurrentCycle).

  // Advance payment_date by 1 year and record last_payment_date
  const { data: updated, error: updateError } = await supabase
    .from('insurance_members')
    .update({
      payment_date: nextPaymentDate,
      last_payment_date: paidISO,
      updated_at: now.toISOString(),
    })
    .eq('member_id', memberId)
    .eq('user_id', user.id)
    .select('updated_at')
    .single()

  if (updateError) {
    console.error('[mark-paid] Failed to update last_payment_date', { user_id: user.id, member_id: memberId, error: updateError.message })
    return err(500, 'INTERNAL_ERROR', 'An error occurred while processing your request')
  }

  const updatedAt = updated?.updated_at ?? now.toISOString()

  // Audit log — no raw user/member UUIDs. The Vercel request ID (in headers) is
  // the trace key if we need to correlate.
  console.log(`[AUDIT] mark-paid: settled premium (paid ${paidISO}) at ${now.toISOString()}`)

  return NextResponse.json({
    data: {
      member_id: memberId,
      name: member.member_name,
      amount_saved: 0,
      payment_date: nextPaymentDate,
      last_payment_date: paidISO,
      monthly_allocation: member.monthly_premium_vnd ?? Math.round((member.annual_payment_vnd ?? 0) / 12),
      updated_at: updatedAt,
    },
  })
}
