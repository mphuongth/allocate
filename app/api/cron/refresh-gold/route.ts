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

  const { data, error } = await supabaseAdmin
    .from('gold_price_settings')
    .update({ price_per_chi: price, updated_at: new Date().toISOString() })
    .not('user_id', 'is', null)
    .select('user_id')

  if (error) {
    return NextResponse.json({ error: 'Failed to update gold price' }, { status: 500 })
  }

  return NextResponse.json({ updated: data?.length ?? 0, price })
}
