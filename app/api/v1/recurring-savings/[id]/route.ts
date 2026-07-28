import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateText, validateUUID, validateYearMonth } from '@/lib/validation'
import { validateLinkedDeposit } from '../linkValidation'
import { ownershipError } from '@/lib/assertOwned'

function toDateCol(ym: string | undefined | null): string | null {
  if (!ym) return null
  return `${ym}-01`
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, goal_id, amount_vnd, effective_from, effective_to, linked_deposit_tx_id } = body

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  let savingId: string
  try {
    savingId = validateUUID(id, 'saving_id')

    if (name !== undefined) {
      updates.name = validateText(name, 'name')
    }
    if ('goal_id' in body) {
      updates.goal_id = goal_id ? validateUUID(goal_id, 'goal_id') : null
    }
    if (amount_vnd !== undefined) {
      const n = validateAmount(amount_vnd, 'amount_vnd')
      if (n <= 0) throw new ValidationError('Amount must be greater than 0.')
      updates.amount_vnd = n
    }
    if ('effective_from' in body) {
      updates.effective_from = effective_from ? toDateCol(validateYearMonth(effective_from, 'effective_from')) : null
    }
    if ('effective_to' in body) {
      updates.effective_to = effective_to ? toDateCol(validateYearMonth(effective_to, 'effective_to')) : null
    }
    if ('linked_deposit_tx_id' in body) {
      updates.linked_deposit_tx_id = linked_deposit_tx_id ? validateUUID(linked_deposit_tx_id, 'linked_deposit_tx_id') : null
    }
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const fromDate = (updates.effective_from ?? null) as string | null
  const toDate = (updates.effective_to ?? null) as string | null
  if (fromDate && toDate && fromDate > toDate) {
    return NextResponse.json({ error: '"Active from" must be before "Active until".' }, { status: 400 })
  }

  // Same check the POST does. Without it, moving an existing saving onto a
  // foreign goal reaches the DB trigger, and the catch-all at the end of this
  // route reports that as "Recurring saving not found" — so creating with a
  // foreign goal says 403 while updating to one says 404 about a row that is
  // right there. The link path below only covers linked_deposit_tx_id, and only
  // when a link survives the update.
  if (updates.goal_id) {
    const ownErr = await ownershipError(supabase, 'savings_goals', 'goal_id', updates.goal_id as string, user.id, 'goal')
    if (ownErr) return ownErr
  }

  // Keep the deposit link consistent with the (possibly changed) goal. Only
  // bother when the goal or the link itself is part of this update.
  if ('goal_id' in body || 'linked_deposit_tx_id' in body) {
    const { data: existing } = await supabase
      .from('recurring_savings')
      .select('goal_id, linked_deposit_tx_id')
      .eq('saving_id', savingId)
      .eq('user_id', user.id)
      .single()
    if (!existing) return NextResponse.json({ error: 'Recurring saving not found' }, { status: 404 })

    const resultingGoal = ('goal_id' in body ? (updates.goal_id as string | null) : existing.goal_id) ?? null
    let resultingLink: string | null
    if ('linked_deposit_tx_id' in body) {
      resultingLink = (updates.linked_deposit_tx_id as string | null) ?? null
    } else if (existing.linked_deposit_tx_id && (existing.goal_id ?? null) !== resultingGoal) {
      // The goal moved out from under an existing link → drop the now cross-goal
      // link rather than leave a stale one that can never resolve.
      resultingLink = null
      updates.linked_deposit_tx_id = null
    } else {
      resultingLink = existing.linked_deposit_tx_id
    }

    if (resultingLink) {
      const linkErr = await validateLinkedDeposit(supabase, user.id, resultingLink, resultingGoal)
      if (linkErr) return NextResponse.json({ error: linkErr }, { status: 400 })
    }
  }

  const { data: saving, error } = await supabase
    .from('recurring_savings')
    .update(updates)
    .eq('saving_id', savingId)
    .eq('user_id', user.id)
    .select('saving_id, name, goal_id, amount_vnd, effective_from, effective_to, linked_deposit_tx_id, savings_goals(goal_name)')
    .single()

  if (error || !saving) return NextResponse.json({ error: 'Recurring saving not found' }, { status: 404 })
  return NextResponse.json(saving)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let savingId: string
  try {
    savingId = validateUUID(id, 'saving_id')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('recurring_savings')
    .delete()
    .eq('saving_id', savingId)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: 'Recurring saving not found' }, { status: 404 })
  return NextResponse.json({ message: 'Recurring saving deleted.' })
}
