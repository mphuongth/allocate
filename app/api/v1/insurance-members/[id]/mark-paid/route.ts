import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function err(status: number, code: string, message: string) {
  return NextResponse.json({ error: code, message }, { status })
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // 400 — UUID validation
  if (!UUID_REGEX.test(id)) {
    return err(400, 'INVALID_MEMBER_ID', 'Invalid member ID format')
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err(401, 'UNAUTHORIZED', 'Authentication required')

  // Fetch member — distinguish 404 vs 403
  const { data: member, error: fetchError } = await supabase
    .from('insurance_members')
    .select('member_id, user_id, member_name, annual_payment_vnd, monthly_premium_vnd, payment_date, updated_at')
    .eq('member_id', id)
    .single()

  if (fetchError || !member) return err(404, 'NOT_FOUND', 'Insurance member not found')
  if (member.user_id !== user.id) return err(403, 'FORBIDDEN', "You don't have permission to mark this payment")

  const now = new Date()
  const todayISO = now.toISOString().split('T')[0]

  // Advance payment_date by exactly 1 year (keep month/day, increment year)
  const nextPaymentDate = member.payment_date
    ? (() => {
        const d = new Date(member.payment_date)
        d.setFullYear(d.getFullYear() + 1)
        return d.toISOString().split('T')[0]
      })()
    : null

  // Count savings records before deletion for audit log
  const { count: savingsCount } = await supabase
    .from('insurance_savings')
    .select('*', { count: 'exact', head: true })
    .eq('insurance_member_id', id)
    .eq('user_id', user.id)

  // Delete all savings records first (reset balance to 0)
  // Delete before update so that if delete fails, member state is unchanged
  const { error: deleteError } = await supabase
    .from('insurance_savings')
    .delete()
    .eq('insurance_member_id', id)
    .eq('user_id', user.id)

  if (deleteError) {
    console.error('[mark-paid] Failed to delete savings', { user_id: user.id, member_id: id, error: deleteError.message })
    return err(500, 'INTERNAL_ERROR', 'An error occurred while processing your request')
  }

  // Advance payment_date by 1 year and record last_payment_date
  const { data: updated, error: updateError } = await supabase
    .from('insurance_members')
    .update({
      payment_date: nextPaymentDate,
      last_payment_date: todayISO,
      updated_at: now.toISOString(),
    })
    .eq('member_id', id)
    .eq('user_id', user.id)
    .select('updated_at')
    .single()

  if (updateError) {
    console.error('[mark-paid] Failed to update last_payment_date', { user_id: user.id, member_id: id, error: updateError.message })
    return err(500, 'INTERNAL_ERROR', 'An error occurred while processing your request')
  }

  const updatedAt = updated?.updated_at ?? now.toISOString()
  const deletedCount = savingsCount ?? 0

  // Audit log
  console.log(`[AUDIT] User ${user.id} marked member ${id} as paid. Deleted ${deletedCount} savings records at ${now.toISOString()}`)

  return NextResponse.json({
    data: {
      member_id: id,
      name: member.member_name,
      amount_saved: 0,
      payment_date: nextPaymentDate,
      last_payment_date: todayISO,
      monthly_allocation: member.monthly_premium_vnd ?? Math.round((member.annual_payment_vnd ?? 0) / 12),
      updated_at: updatedAt,
    },
  })
}
