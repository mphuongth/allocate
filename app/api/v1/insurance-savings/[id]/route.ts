import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: record } = await supabase
    .from('insurance_savings')
    .select('id, user_id')
    .eq('id', id)
    .single()

  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (record.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await supabase.from('insurance_savings').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  return NextResponse.json({ success: true })
}
