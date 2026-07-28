import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateUUID } from '@/lib/validation'
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
    .from('plan_dca_skips')
    .select('fund_id')
    .eq('plan_id', planId)

  if (error) return NextResponse.json({ error: 'Failed to fetch DCA skips' }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { fund_id } = body

  let planId: string
  let cleanFundId: string
  try {
    planId = validateUUID(id, 'plan_id')
    if (!fund_id) throw new ValidationError('fund_id is required')
    cleanFundId = validateUUID(fund_id, 'fund_id')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const { data: plan } = await supabase.from('monthly_plans').select('id').eq('id', planId).eq('user_id', user.id).single()
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  // The referenced record must belong to the plan's owner too. A valid UUID
  // isn't proof of ownership, and the DB trigger that enforces this (#525)
  // fires mid-write — checking here turns that into a clear 403.
  if (!(await isOwnedBy(supabase, 'funds', 'id', cleanFundId, user.id))) {
    return NextResponse.json({ error: "You don't have permission to access this fund." }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('plan_dca_skips')
    .upsert({ plan_id: planId, fund_id: cleanFundId }, { onConflict: 'plan_id,fund_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Failed to skip DCA' }, { status: 500 })

  // Remove the pending (un-recorded) seeded DCA row for this fund so the skipped
  // contribution drops out of the plan. A recorded buy (units set) is left intact.
  await supabase
    .from('investment_transactions')
    .delete()
    .eq('plan_id', planId)
    .eq('fund_id', cleanFundId)
    .eq('asset_type', 'fund')
    .eq('is_dca_seeded', true)
    .is('units', null)

  return NextResponse.json(data, { status: 201 })
}
