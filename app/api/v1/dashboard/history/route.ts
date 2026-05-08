import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

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

  let snapshotQuery = supabase
    .from('net_worth_snapshots')
    .select('snapshot_date, total_assets')
    .eq('user_id', user.id)
    .order('snapshot_date', { ascending: true })

  if (fromDate) snapshotQuery = snapshotQuery.gte('snapshot_date', fromDate)

  const { data: snapshots, error } = await snapshotQuery
  if (error) return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 })

  // If we have enough real snapshots, return them — filtering out any zero-value rows
  // that can appear when a snapshot was saved during a now-deleted sell transaction.
  const validSnapshots = (snapshots ?? []).filter((r) => r.total_assets > 0)
  if (validSnapshots.length >= 2) {
    return NextResponse.json(
      validSnapshots.map((row) => ({
        label: new Date(row.snapshot_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        value: row.total_assets,
      }))
    )
  }

  // Not enough snapshots yet — synthesize monthly history from investment transactions only.
  // Withdrawals are intentionally excluded: they are recorded at market value which can exceed
  // original cost, driving the cumulative negative and causing a visual cliff.
  const { data: txData } = await supabase
    .from('investment_transactions')
    .select('investment_date, amount_vnd')
    .eq('user_id', user.id)
    .eq('transaction_type', 'investment')
    .order('investment_date', { ascending: true })

  if (!txData || txData.length === 0) {
    // Return whatever snapshots we have (may be 0 or 1)
    return NextResponse.json(
      (snapshots ?? []).map((row) => ({
        label: new Date(row.snapshot_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        value: row.total_assets,
      }))
    )
  }

  // Group by month, compute running cumulative invested amount
  const monthlyMap = new Map<string, number>()
  let cumulative = 0
  for (const tx of txData) {
    const month = tx.investment_date.slice(0, 7) // YYYY-MM
    cumulative += tx.amount_vnd
    monthlyMap.set(month, cumulative)
  }

  // Filter by time range
  const syntheticPoints = Array.from(monthlyMap.entries())
    .filter(([month]) => !fromDate || month >= fromDate.slice(0, 7))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, value]) => ({
      label: new Date(month + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      value,
    }))

  return NextResponse.json(syntheticPoints)
}
