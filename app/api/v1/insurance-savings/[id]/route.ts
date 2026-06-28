import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateUUID } from '@/lib/validation'

// Reverse an ad-hoc logged contribution. Plan-derived history rows are computed
// (not stored) and never reach here. RLS also scopes deletes to the owner; the
// explicit user_id filter keeps the 404 path honest.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let savingsId: string
  try {
    savingsId = validateUUID(id, 'savings_id')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('insurance_savings')
    .delete()
    .eq('id', savingsId)
    .eq('user_id', user.id)
    .select('id')

  if (error) return NextResponse.json({ error: 'Failed to delete savings' }, { status: 500 })
  if (!data || data.length === 0) return NextResponse.json({ error: 'Savings entry not found' }, { status: 404 })
  return NextResponse.json({ message: 'Savings entry deleted.' })
}
