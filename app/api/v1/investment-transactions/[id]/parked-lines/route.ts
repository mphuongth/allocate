import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateUUID } from '@/lib/validation'

// The DCA lines a deposit was parked for (park_dca_lines_in_deposit,
// 20261003000002), each with the share it put in — what the maturity sheet
// splits the payout by when the deposit goes back into those funds.
//
// RLS on plan_dca_skips scopes the read to the caller's own plans, so another
// user's deposit simply has no lines.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let depositId: string
  try {
    depositId = validateUUID(id, 'transaction_id')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const { data, error } = await supabase
    .from('plan_dca_skips')
    .select('fund_id, parked_amount_vnd')
    .eq('parked_in_tx_id', depositId)
    .order('fund_id')
  if (error || !data) {
    console.error('parked-lines: read failed', error?.message)
    return NextResponse.json({ error: 'Failed to read the parked lines' }, { status: 500 })
  }
  return NextResponse.json(data.map((r) => ({ fund_id: r.fund_id, share: r.parked_amount_vnd ?? 0 })))
}
