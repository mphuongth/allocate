import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { scrapeGoldPrice } from '@/lib/scrape-gold'
import { verifyCronAuth } from '@/lib/cron-auth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: Request) {
  if (!verifyCronAuth(request.headers.get('Authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
