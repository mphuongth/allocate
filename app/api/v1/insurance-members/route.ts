import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: members, error } = await supabase
    .from('insurance_members')
    .select('*, insurance_savings(id, amount_saved_vnd, saved_date, created_at)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 })

  const membersWithTotals = (members ?? []).map((m) => {
    const savings = Array.isArray(m.insurance_savings) ? m.insurance_savings : []
    const total_saved_vnd = savings.reduce((sum: number, s: { amount_saved_vnd: number }) => sum + (s.amount_saved_vnd ?? 0), 0)
    return { ...m, total_saved_vnd }
  })

  return NextResponse.json({ members: membersWithTotals })
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { member_name, relationship, annual_payment_vnd, payment_date } = body

  if (!member_name || typeof member_name !== 'string' || member_name.trim().length === 0) {
    return NextResponse.json({ error: 'Member name is required.' }, { status: 400 })
  }
  if (!relationship || typeof relationship !== 'string' || relationship.trim().length === 0) {
    return NextResponse.json({ error: 'Relationship is required.' }, { status: 400 })
  }
  const annualNum = Number(annual_payment_vnd)
  if (!annual_payment_vnd || isNaN(annualNum) || annualNum <= 0) {
    return NextResponse.json({ error: 'Annual payment must be greater than 0.' }, { status: 400 })
  }

  const { data: member, error } = await supabase
    .from('insurance_members')
    .insert({
      user_id: user.id,
      member_name: member_name.trim(),
      relationship: relationship.trim(),
      annual_payment_vnd: annualNum,
      payment_date: payment_date || null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Failed to create member' }, { status: 500 })
  return NextResponse.json(member, { status: 201 })
}
