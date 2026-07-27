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

  // One statement does the read, the carry-over and the write. Reading the
  // current price separately used to leave a gap on both sides: the read's error
  // was discarded, so a transient failure stored previous = null and erased the
  // comparison point behind a 200; and a concurrent refresh landing in the gap
  // produced a mismatched previous/current pair. The RPC's INSERT … ON CONFLICT
  // DO UPDATE has no read to fail and takes a row lock, so concurrent refreshes
  // serialize into a valid chain (#528).
  const { data, error } = await supabase
    .rpc('refresh_gold_price', { p_price: price })
    .single()

  if (error || !data) {
    console.error('gold-price refresh: atomic refresh failed', error?.message)
    return NextResponse.json({ error: 'Failed to save gold price' }, { status: 500 })
  }

  return NextResponse.json(data)
}
