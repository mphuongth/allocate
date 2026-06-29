import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateUUID } from '@/lib/validation'

function err(status: number, code: string, message: string) {
  return NextResponse.json({ error: code, message }, { status })
}

// Reverse the most recent mark-paid: restore the dates it overwrote (from the
// snapshot) and clear the snapshot so undo is one-shot per settlement. Only
// applicable while the member is in a settled state (last_payment_date set).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

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

  const { data: member, error: fetchError } = await supabase
    .from('insurance_members')
    .select('member_id, user_id, member_name, payment_date, last_payment_date, prev_payment_date, prev_last_payment_date')
    .eq('member_id', memberId)
    .single()

  if (fetchError || !member) return err(404, 'NOT_FOUND', 'Insurance member not found')
  if (member.user_id !== user.id) return err(403, 'FORBIDDEN', "You don't have permission to undo this payment")
  if (!member.last_payment_date) return err(409, 'NOT_SETTLED', 'There is no settlement to undo')

  // Restore the snapshot when present. Fallback (legacy rows settled before the
  // snapshot existed): roll payment_date back a year and clear last_payment_date,
  // which is the deterministic inverse of mark-paid's forward step.
  const restoredPaymentDate = member.prev_payment_date ?? (
    member.payment_date
      ? (() => {
          const d = new Date(member.payment_date)
          d.setFullYear(d.getFullYear() - 1)
          return d.toISOString().split('T')[0]
        })()
      : null
  )

  const { error: updateError } = await supabase
    .from('insurance_members')
    .update({
      payment_date: restoredPaymentDate,
      last_payment_date: member.prev_last_payment_date,
      prev_payment_date: null,
      prev_last_payment_date: null,
      updated_at: new Date().toISOString(),
    })
    .eq('member_id', memberId)
    .eq('user_id', user.id)

  if (updateError) {
    console.error('[mark-paid/undo] Failed to restore', { member_id: memberId, error: updateError.message })
    return err(500, 'INTERNAL_ERROR', 'An error occurred while processing your request')
  }

  console.log(`[AUDIT] mark-paid/undo: reverted settlement at ${new Date().toISOString()}`)

  return NextResponse.json({
    data: {
      member_id: memberId,
      name: member.member_name,
      payment_date: restoredPaymentDate,
      last_payment_date: member.prev_last_payment_date,
    },
  })
}
