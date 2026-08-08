import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { readJsonBody } from '@/lib/apiBody'
import { parseFundPayload, dcaGoalOwnershipError, unpriceableFundCodeError } from '@/lib/fundPayload'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: fund, error } = await supabase
    .from('funds')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !fund) {
    return NextResponse.json({ error: 'Fund not found' }, { status: 404 })
  }

  return NextResponse.json(fund)
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response

  // `dca` is null when the caller omitted is_dca — partial-update semantics, so
  // a name/NAV edit from the Add/Edit form preserves the existing DCA config
  // rather than silently wiping it. The toggle/amount/goal handlers always send
  // is_dca, so they're unaffected.
  const payload = parseFundPayload(parsed.body, 'update')
  if (!payload.ok) return payload.response
  const { fund: fields, dca } = payload

  // Read the stored pricing state so the code check only fires on a real
  // transition — see unpriceableFundCodeError. A miss here is not a 404: the
  // update below already scopes by id + user_id and reports a missing row.
  const { data: previous } = await supabase
    .from('funds')
    .select('code, nav_auto_sync')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  const unpriceable = await unpriceableFundCodeError(fields, previous)
  if (unpriceable) return unpriceable

  const update: Record<string, unknown> = { ...fields }
  if (dca) {
    Object.assign(update, dca)
    if (dca.dca_goal_id) {
      const denied = await dcaGoalOwnershipError(supabase, dca.dca_goal_id, user.id)
      if (denied) return denied
    }
  }

  // Disabling is a cross-table state change: the fund config and every pending
  // seeded allocation must commit (or roll back) together. The RPC also takes
  // the same row lock used by plan seeding, so a concurrent plan load cannot
  // commit a stale pending row after this cleanup finishes.
  const disablingDca = dca?.is_dca === false
  const result = disablingDca
    ? await supabase
        .rpc('disable_fund_dca', {
          p_fund_id: id,
          p_name: update.name,
          p_code: update.code,
          p_fund_type: update.fund_type,
          p_nav: update.nav,
          // undefined when the caller didn't send the flag; the RPC coalesces a
          // null back to the stored value rather than switching sync off.
          p_nav_auto_sync: update.nav_auto_sync ?? null,
        })
        .single()
    : await supabase
        .from('funds')
        .update(update)
        .eq('id', id)
        .eq('user_id', user.id)
        .select()
        .single()

  const { data: fund, error } = result

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Code already exists' }, { status: 409 })
    }
    // Zero rows matched: the regular update path surfaces this as PGRST116 (from
    // .single()), the disable RPC as P0002 (no_data_found). Both mean the fund
    // doesn't exist or isn't the caller's — a 404, not a generic 500, and it
    // avoids disclosing whether a foreign fund exists. (This is why the `if
    // (!fund)` guard below never fires for the update path — .single() reports a
    // zero-row result as an error, not null data.)
    if (error.code === 'P0002' || error.code === 'PGRST116') {
      return NextResponse.json({ error: 'Fund not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to update fund' }, { status: 500 })
  }

  if (!fund) {
    return NextResponse.json({ error: 'Fund not found' }, { status: 404 })
  }

  return NextResponse.json(fund)
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: fund } = await supabase
    .from('funds')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!fund) {
    return NextResponse.json({ error: 'Fund not found' }, { status: 404 })
  }

  const { error } = await supabase.from('funds').delete().eq('id', id).eq('user_id', user.id)

  if (error) {
    // A fund referenced by a monthly-plan allocation is protected by an
    // ON DELETE RESTRICT foreign key (Postgres 23503). Funds drive cash-flow
    // planning, so we hard-block the delete and return a specific, actionable
    // 409 (code: fund_in_use) instead of a generic 500 — the UI tells the user
    // to remove it from the plan first (#1).
    if (error.code === '23503') {
      return NextResponse.json({ error: 'Fund is in use', code: 'fund_in_use' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to delete fund' }, { status: 500 })
  }

  return new NextResponse(null, { status: 204 })
}
