import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { buildDashboardOverview } from '@/lib/dashboardOverview'
import { createServerTiming } from '@/lib/serverTiming'

export const dynamic = 'force-dynamic'

// Auth + transport only. Every figure is computed in lib/dashboardOverview, so
// the PDF report route can derive the same numbers server-side instead of
// rendering a client-supplied payload (#594).
//
// The response carries a Server-Timing header naming each awaited step — the
// auth check, the two read rounds, the snapshot write — so a slow load can be
// broken down from the response itself.
export async function GET() {
  const timing = createServerTiming()
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await timing.measure('auth', () => supabase.auth.getUser())
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await buildDashboardOverview(supabase, user.id, timing)
  const headers = { 'Server-Timing': timing.header() }
  if (!result.ok) {
    return NextResponse.json({ error: 'Failed to fetch dashboard data' }, { status: 500, headers })
  }

  return NextResponse.json(result.data, { headers })
}
