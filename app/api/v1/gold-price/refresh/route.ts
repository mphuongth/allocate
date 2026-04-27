import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { scrapeGoldPrice } from '@/lib/scrape-gold'

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let price: number
  try {
    price = await scrapeGoldPrice()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Scraping failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  // Read current price before overwriting so we can store it as previous
  const { data: existing } = await supabase
    .from('gold_price_settings')
    .select('price_per_chi')
    .eq('user_id', user.id)
    .single()

  const { data, error } = await supabase
    .from('gold_price_settings')
    .upsert({
      user_id: user.id,
      price_per_chi: price,
      previous_price_per_chi: existing?.price_per_chi ?? null,
      updated_at: new Date().toISOString(),
    })
    .select('price_per_chi, previous_price_per_chi, updated_at')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Failed to save gold price' }, { status: 500 })
  }

  return NextResponse.json(data)
}
