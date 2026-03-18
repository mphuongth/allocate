import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: goal, error } = await supabase
    .from('savings_goals')
    .select('*')
    .eq('goal_id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
  return NextResponse.json(goal)
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { goal_name, description } = body

  if (!goal_name || typeof goal_name !== 'string' || goal_name.trim().length === 0) {
    return NextResponse.json({ error: 'Goal name is required.' }, { status: 400 })
  }

  const { data: goal, error } = await supabase
    .from('savings_goals')
    .update({ goal_name: goal_name.trim(), description: description?.trim() || null, updated_at: new Date().toISOString() })
    .eq('goal_id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error || !goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
  return NextResponse.json(goal)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Count linked transactions before delete (ON DELETE SET NULL handles the nulling)
  const { count } = await supabase
    .from('investment_transactions')
    .select('*', { count: 'exact', head: true })
    .eq('goal_id', id)
    .eq('user_id', user.id)

  const { error } = await supabase
    .from('savings_goals')
    .delete()
    .eq('goal_id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
  return NextResponse.json({ message: `Goal deleted. ${count ?? 0} transactions moved to Unassigned Investments.` })
}
