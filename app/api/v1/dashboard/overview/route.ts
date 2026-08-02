import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { buildDashboardOverview } from '@/lib/dashboardOverview'

export const dynamic = 'force-dynamic'

// Auth + transport only. Every figure is computed in lib/dashboardOverview, so
// the PDF report route can derive the same numbers server-side instead of
// rendering a client-supplied payload (#594).
export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await buildDashboardOverview(supabase, user.id)
  if (!result.ok) {
    return NextResponse.json({ error: 'Failed to fetch dashboard data' }, { status: 500 })
  }

  return NextResponse.json(result.data)
}
