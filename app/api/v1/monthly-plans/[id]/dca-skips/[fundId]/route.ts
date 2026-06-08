import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateUUID } from '@/lib/validation'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; fundId: string }> }
) {
  const { id, fundId } = await params

  let planId: string
  let cleanFundId: string
  try {
    planId = validateUUID(id, 'plan_id')
    cleanFundId = validateUUID(fundId, 'fund_id')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: plan } = await supabase.from('monthly_plans').select('id').eq('id', planId).eq('user_id', user.id).single()
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  // Removing the skip re-includes the fund; the next full plan fetch re-seeds it.
  const { error } = await supabase
    .from('plan_dca_skips')
    .delete()
    .eq('plan_id', planId)
    .eq('fund_id', cleanFundId)

  if (error) return NextResponse.json({ error: 'Skip not found' }, { status: 404 })
  return new NextResponse(null, { status: 204 })
}
