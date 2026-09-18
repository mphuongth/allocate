import { NextResponse } from 'next/server'
import { priceAutoSyncFunds } from '@/lib/fundPricing'
import { verifyCronAuth } from '@/lib/cron-auth'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type FundRow = { id: string; code: string; fund_type: string | null }

export async function GET(request: Request) {
  if (!verifyCronAuth(request.headers.get('Authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Built here, not at module scope, so the build never needs the service-role
  // secret (#536).
  const supabaseAdmin = createSupabaseAdminClient()
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  // nav_auto_sync is the per-fund opt-in. `fund_type` decides WHICH source
  // prices the row — an ETF off the exchange, everything else off the Fmarket
  // feed — see lib/fundPricing.ts.
  const { data: funds, error: fetchError } = await supabaseAdmin
    .from('funds')
    .select('id, code, fund_type')
    .eq('nav_auto_sync', true)

  if (fetchError) {
    return NextResponse.json({ error: 'Failed to fetch funds' }, { status: 500 })
  }

  if (!funds || funds.length === 0) {
    return NextResponse.json({ updated: 0, failed: 0 })
  }

  const rows = funds as FundRow[]
  const priced = await priceAutoSyncFunds(rows)

  // Group by resolved price so every fund sharing one updates in a single
  // statement, across all users.
  const byPrice = new Map<number, string[]>()
  const reasons = new Set<string>()
  let failed = 0
  for (const fund of rows) {
    const outcome = priced.get(fund)
    if (!outcome || !outcome.ok) {
      // A source being down fails only the funds that source prices, so this
      // count is no longer all-or-nothing: Fmarket can be unreachable while
      // every ETF still prices, and the run reports exactly that.
      if (outcome) reasons.add(outcome.error)
      failed += 1
      continue
    }
    const ids = byPrice.get(outcome.price) ?? []
    ids.push(fund.id)
    byPrice.set(outcome.price, ids)
  }

  if (reasons.size > 0) {
    console.error('[cron refresh-navs] could not price %d fund(s):', failed, [...reasons].join(' | '))
  }

  let updated = 0
  await Promise.all(
    Array.from(byPrice.entries()).map(async ([nav, ids]) => {
      const { error } = await supabaseAdmin
        .from('funds')
        .update({ nav, updated_at: new Date().toISOString() })
        .in('id', ids)

      if (error) {
        failed += ids.length
      } else {
        updated += ids.length
      }
    })
  )

  return NextResponse.json({ updated, failed })
}
