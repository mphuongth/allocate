import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { goal_id } = body

  if (goal_id) {
    const { data: goal } = await supabase
      .from('savings_goals')
      .select('goal_id')
      .eq('goal_id', goal_id)
      .eq('user_id', user.id)
      .single()
    if (!goal) return NextResponse.json({ error: "You don't have permission to access this goal." }, { status: 403 })
  }

  const { data: transaction, error } = await supabase
    .from('investment_transactions')
    .update({ goal_id: goal_id || null, updated_at: new Date().toISOString() })
    .eq('transaction_id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error || !transaction) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  return NextResponse.json(transaction)
}
