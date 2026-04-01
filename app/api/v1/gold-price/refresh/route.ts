import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

interface SJCPriceItem {
  TypeName: string
  BranchName: string
  SellValue: number
}

// Fetches SJC ring gold (nhẫn 99.99%) sell price for HCM via SJC's own JSON API.
// SellValue is in VND per lượng (1 lượng = 10 chỉ) → divide by 10 for price_per_chi.
async function fetchSJCRingGoldPrice(): Promise<number> {
  const res = await fetch('https://sjc.com.vn/GoldPrice/Services/PriceService.ashx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'method=getCurrentGoldPrice',
  })
  if (!res.ok) throw new Error(`SJC API HTTP ${res.status}`)

  const json = await res.json()
  if (!json.success || !Array.isArray(json.data)) throw new Error('SJC: unexpected response format')

  // "Vàng nhẫn SJC 99,99% 1 chỉ, 2 chỉ, 5 chỉ" — HCM branch
  const item: SJCPriceItem | undefined = json.data.find(
    (d: SJCPriceItem) =>
      d.TypeName.includes('nhẫn') &&
      d.TypeName.includes('99,99') &&
      d.BranchName === 'Hồ Chí Minh'
  )
  if (!item) throw new Error('SJC: nhẫn 99.99% HCM price not found')

  const pricePerLuong = item.SellValue
  if (!pricePerLuong || pricePerLuong <= 0) throw new Error('SJC: invalid price value')

  return pricePerLuong / 10
}

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let price: number
  try {
    price = await fetchSJCRingGoldPrice()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch gold price'
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
