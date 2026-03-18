import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { insurance_member_id, amount_saved_vnd, saved_date } = body

  if (!insurance_member_id) return NextResponse.json({ error: 'insurance_member_id is required' }, { status: 400 })
  const amount = Number(amount_saved_vnd)
  if (!amount_saved_vnd || isNaN(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Amount must be greater than 0' }, { status: 400 })
  }

  // Verify member belongs to user
  const { data: member } = await supabase
    .from('insurance_members')
    .select('member_id')
    .eq('member_id', insurance_member_id)
    .eq('user_id', user.id)
    .single()
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('insurance_savings')
    .insert({
      user_id: user.id,
      insurance_member_id,
      amount_saved_vnd: amount,
      saved_date: saved_date || new Date().toISOString().split('T')[0],
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Failed to record savings' }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
