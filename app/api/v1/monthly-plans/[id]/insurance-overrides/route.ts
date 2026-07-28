import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateUUID } from '@/lib/validation'
import { isOwnedBy } from '@/lib/assertOwned'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let planId: string
  try {
    planId = validateUUID(id, 'plan_id')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: plan } = await supabase.from('monthly_plans').select('id').eq('id', planId).eq('user_id', user.id).single()
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('plan_insurance_member_overrides')
    .select('id, member_id, monthly_amount_override_vnd')
    .eq('plan_id', planId)

  if (error) return NextResponse.json({ error: 'Failed to fetch overrides' }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { member_id, monthly_amount_override_vnd } = await request.json()

  let planId: string
  let cleanMemberId: string
  let cleanAmount: number
  try {
    planId = validateUUID(id, 'plan_id')
    if (!member_id) throw new ValidationError('member_id is required')
    cleanMemberId = validateUUID(member_id, 'member_id')
    cleanAmount = validateAmount(monthly_amount_override_vnd, 'monthly_amount_override_vnd')
    if (cleanAmount <= 0) throw new ValidationError('Monthly amount must be positive')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const { data: plan } = await supabase.from('monthly_plans').select('id').eq('user_id', user.id).eq('id', planId).single()
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  // The referenced record must belong to the plan's owner too. A valid UUID
  // isn't proof of ownership, and the DB trigger that enforces this (#525)
  // fires mid-write — checking here turns that into a clear 403.
  if (!(await isOwnedBy(supabase, 'insurance_members', 'member_id', cleanMemberId, user.id))) {
    return NextResponse.json({ error: "You don't have permission to access this insurance member." }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('plan_insurance_member_overrides')
    .upsert({ plan_id: planId, member_id: cleanMemberId, monthly_amount_override_vnd: cleanAmount }, { onConflict: 'plan_id,member_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Failed to save override' }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
