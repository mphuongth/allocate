import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: goals, error } = await supabase
    .from('savings_goals')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Failed to fetch goals' }, { status: 500 })
  return NextResponse.json({ goals })
}

export async function POST(request: NextRequest) {
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
    .insert({ user_id: user.id, goal_name: goal_name.trim(), description: description?.trim() || null })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Goal name already exists' }, { status: 409 })
    return NextResponse.json({ error: 'Failed to create goal' }, { status: 500 })
  }

  return NextResponse.json(goal, { status: 201 })
}
