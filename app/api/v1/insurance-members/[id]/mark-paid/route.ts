import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const { data: member } = await supabase
    .from('insurance_members')
    .select('member_id, user_id, payment_date')
    .eq('member_id', id)
    .single()

  if (!member) return NextResponse.json({ error: 'Unable to find insurance record. Please refresh and try again.' }, { status: 404 })
  if (member.user_id !== user.id) return NextResponse.json({ error: "You don't have permission to mark this payment" }, { status: 403 })

  if (member.payment_date) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const paymentDate = new Date(member.payment_date)
    if (paymentDate > today) {
      return NextResponse.json({ error: 'Payment date has not arrived yet' }, { status: 422 })
    }
  }

  // Delete all savings records to reset balance to 0
  const { error: deleteError } = await supabase
    .from('insurance_savings')
    .delete()
    .eq('insurance_member_id', id)
    .eq('user_id', user.id)

  if (deleteError) return NextResponse.json({ error: 'An unexpected error occurred. Please try again.' }, { status: 500 })

  return NextResponse.json({
    data: {
      member_id: id,
      amount_saved: 0,
      payment_date: member.payment_date,
      last_payment_date: new Date().toISOString().split('T')[0],
    },
  })
}
