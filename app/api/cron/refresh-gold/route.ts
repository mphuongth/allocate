import { NextResponse } from 'next/server'
import { scrapeGoldPrice } from '@/lib/scrape-gold'
import { verifyCronAuth } from '@/lib/cron-auth'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export async function GET(request: Request) {
  if (!verifyCronAuth(request.headers.get('Authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Built here, not at module scope, so the build never needs the service-role
  // secret (#536). Resolved before the scrape: if we can't persist the result
  // there's no reason to hit DOJI at all.
  const supabaseAdmin = createSupabaseAdminClient()
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  let price: number
  try {
    price = await scrapeGoldPrice()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Scraping failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  // Keep the same invariant as the user-scoped refresh: previous_price_per_chi
  // is the value immediately before price_per_chi. A direct bulk UPDATE used to
  // overwrite only the current price, so the previous value became older on
  // every daily run. The RPC performs the carry-over and write in one statement;
  // concurrent manual/cron refreshes therefore serialize per row instead of
  // producing a mismatched pair (#547).
  const { data, error } = await supabaseAdmin
    .rpc('refresh_gold_price_all', { p_price: price })

  if (error || typeof data !== 'number') {
    console.error('gold cron: atomic refresh failed', error?.message)
    return NextResponse.json({ error: 'Failed to update gold price' }, { status: 500 })
  }

  return NextResponse.json({ updated: data, price })
}
