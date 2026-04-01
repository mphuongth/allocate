import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

// Parse Vietnamese number format: "17,050" or "17.050,00"
function parseVietnameseNumber(raw: string): number {
  const cleaned = raw.replace(/[^\d.,]/g, '').trim()
  if (/,\d{2}$/.test(cleaned)) {
    return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'))
  }
  return parseFloat(cleaned.replace(/,/g, ''))
}

async function scrapeDoji(): Promise<number> {
  const html = await fetch('https://giavang.doji.vn', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'vi-VN,vi;q=0.9',
    },
  }).then((r) => r.text())

  // Page table: <td>NHẪN TRÒN 9999</td><td>BUY</td><td>SELL</td>
  // Doji's own ring gold (NHẪN TRÒN 9999) — different from SJC pricing
  // Price unit on page: nghìn VND/chỉ — multiply by 1000 to get VND/chỉ
  const match = html.match(/NHẪN TRÒN[\s\S]{0,300}?<td[^>]*>([\d.,]+)<\/td>/)
  if (!match) throw new Error('Doji: NHẪN TRÒN price row not found')

  const raw = parseVietnameseNumber(match[1])
  if (isNaN(raw) || raw <= 0) throw new Error('Doji: invalid price value')

  return raw * 1000
}

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let price: number
  try {
    price = await scrapeDoji()
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
