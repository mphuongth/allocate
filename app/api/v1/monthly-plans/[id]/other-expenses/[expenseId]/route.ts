import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; expenseId: string }> }) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, expenseId } = await params

  // Verify ownership via plan
  const { data: plan } = await supabase
    .from('monthly_plans')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  const { error } = await supabase
    .from('plan_other_expenses')
    .delete()
    .eq('id', expenseId)
    .eq('plan_id', id)

  if (error) return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}
