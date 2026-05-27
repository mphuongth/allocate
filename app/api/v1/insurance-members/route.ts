import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateDate, validateText } from '@/lib/validation'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: members, error } = await supabase
    .from('insurance_members')
    .select('member_id, member_name, relationship, annual_payment_vnd, monthly_premium_vnd, payment_date, coverage_type, last_payment_date, amount_saved_vnd, version, created_at, updated_at, insurance_savings(id, amount_saved_vnd, saved_date, created_at)')
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

  let cleanName: string
  let cleanRelationship: string
  let cleanAnnual: number
  let cleanPaymentDate: string | null = null

  try {
    cleanName = validateText(member_name, 'member_name')
    cleanRelationship = validateText(relationship, 'relationship')
    cleanAnnual = validateAmount(annual_payment_vnd, 'annual_payment_vnd')
    if (cleanAnnual <= 0) throw new ValidationError('Annual payment must be greater than 0.')
    if (payment_date) cleanPaymentDate = validateDate(payment_date, 'payment_date')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const { data: member, error } = await supabase
    .from('insurance_members')
    .insert({
      user_id: user.id,
      member_name: cleanName,
      relationship: cleanRelationship,
      annual_payment_vnd: cleanAnnual,
      payment_date: cleanPaymentDate,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Failed to create member' }, { status: 500 })
  return NextResponse.json(member, { status: 201 })
}
