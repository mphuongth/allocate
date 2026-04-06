import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const range = searchParams.get('range') ?? 'all'

  const fromDate = (() => {
    const now = new Date()
    if (range === '6m') { now.setMonth(now.getMonth() - 6); return now.toISOString().split('T')[0] }
    if (range === '1y') { now.setFullYear(now.getFullYear() - 1); return now.toISOString().split('T')[0] }
    if (range === '3y') { now.setFullYear(now.getFullYear() - 3); return now.toISOString().split('T')[0] }
    return null
  })()

  let query = supabase
    .from('net_worth_snapshots')
    .select('snapshot_date, total_assets')
    .eq('user_id', user.id)
    .order('snapshot_date', { ascending: true })

  if (fromDate) query = query.gte('snapshot_date', fromDate)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 })

  const points = (data ?? []).map((row) => ({
    label: new Date(row.snapshot_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    value: row.total_assets,
  }))

  return NextResponse.json(points)
}
