import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('gold_price_settings')
    .select('price_per_chi, updated_at')
    .eq('user_id', user.id)
    .single()

  return NextResponse.json(data ?? null)
}
