import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// The shared bank reference list (code → name + logo). Used by the deposit form's
// bank selector and, later, the merge destination picker. Reference data: same
// for every user, read-only from the app (managed via migration).
export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('banks')
    .select('code, name, logo_url')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) return NextResponse.json({ error: 'Failed to fetch banks' }, { status: 500 })
  return NextResponse.json(data ?? [])
}
