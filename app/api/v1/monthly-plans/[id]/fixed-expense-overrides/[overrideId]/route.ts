import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateUUID } from '@/lib/validation'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; overrideId: string }> }
) {
  const { id, overrideId } = await params

  let planId: string
  let cleanOverrideId: string
  try {
    planId = validateUUID(id, 'plan_id')
    cleanOverrideId = validateUUID(overrideId, 'override_id')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: plan } = await supabase.from('monthly_plans').select('id').eq('id', planId).eq('user_id', user.id).single()
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  const { error } = await supabase
    .from('fixed_expense_overrides')
    .delete()
    .eq('id', cleanOverrideId)
    .eq('plan_id', planId)

  if (error) return NextResponse.json({ error: 'Override not found' }, { status: 404 })
  return new NextResponse(null, { status: 204 })
}
