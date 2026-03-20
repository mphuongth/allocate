import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  const { id, memberId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: plan } = await supabase.from('monthly_plans').select('id').eq('id', id).eq('user_id', user.id).single()
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  const { error } = await supabase
    .from('plan_excluded_insurance_members')
    .delete()
    .eq('plan_id', id)
    .eq('member_id', memberId)

  if (error) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return new NextResponse(null, { status: 204 })
}
