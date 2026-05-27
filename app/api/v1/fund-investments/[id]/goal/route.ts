import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateUUID } from '@/lib/validation'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  const { goal_id } = body

  let txId: string
  let cleanGoalId: string | null = null
  try {
    txId = validateUUID(id, 'transaction_id')
    if (goal_id !== null && goal_id !== undefined && goal_id !== '') {
      cleanGoalId = validateUUID(goal_id, 'goal_id')
    }
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const { data, error } = await supabase
    .from('investment_transactions')
    .update({ goal_id: cleanGoalId })
    .eq('transaction_id', txId)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}
