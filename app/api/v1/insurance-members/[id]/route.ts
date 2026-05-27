import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateDate, validateText, validateUUID } from '@/lib/validation'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { member_name, relationship, annual_payment_vnd, payment_date } = body

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  let memberId: string

  try {
    memberId = validateUUID(id, 'member_id')

    if (member_name !== undefined) {
      updates.member_name = validateText(member_name, 'member_name')
    }
    if (relationship !== undefined) {
      updates.relationship = validateText(relationship, 'relationship')
    }
    if (annual_payment_vnd !== undefined) {
      const n = validateAmount(annual_payment_vnd, 'annual_payment_vnd')
      if (n <= 0) throw new ValidationError('Annual payment must be greater than 0.')
      updates.annual_payment_vnd = n
      // monthly_premium_vnd is a generated stored column — auto-recalculated by DB
    }
    if (payment_date !== undefined) {
      updates.payment_date = payment_date === null || payment_date === '' ? null : validateDate(payment_date, 'payment_date')
    }
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const { data: member, error } = await supabase
    .from('insurance_members')
    .update(updates)
    .eq('member_id', memberId)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error || !member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  return NextResponse.json(member)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let memberId: string
  try {
    memberId = validateUUID(id, 'member_id')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('insurance_members')
    .delete()
    .eq('member_id', memberId)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  return NextResponse.json({ message: 'Member deleted.' })
}
