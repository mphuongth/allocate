import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { member_name, relationship, annual_payment_vnd, payment_date } = body

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (member_name !== undefined) {
    if (!member_name || member_name.trim().length === 0) {
      return NextResponse.json({ error: 'Member name is required.' }, { status: 400 })
    }
    updates.member_name = member_name.trim()
  }
  if (relationship !== undefined) {
    if (!relationship || relationship.trim().length === 0) {
      return NextResponse.json({ error: 'Relationship is required.' }, { status: 400 })
    }
    updates.relationship = relationship.trim()
  }
  if (annual_payment_vnd !== undefined) {
    const annualNum = Number(annual_payment_vnd)
    if (isNaN(annualNum) || annualNum <= 0) {
      return NextResponse.json({ error: 'Annual payment must be greater than 0.' }, { status: 400 })
    }
    updates.annual_payment_vnd = annualNum
    // monthly_premium_vnd is a generated stored column — auto-recalculated by DB
  }
  if (payment_date !== undefined) updates.payment_date = payment_date || null

  const { data: member, error } = await supabase
    .from('insurance_members')
    .update(updates)
    .eq('member_id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error || !member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  return NextResponse.json(member)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('insurance_members')
    .delete()
    .eq('member_id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  return NextResponse.json({ message: 'Member deleted.' })
}
