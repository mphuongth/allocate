import type { SupabaseClient } from '@supabase/supabase-js'

// One sentence per refusal, said the same way whether this file worked it out or
// the table did. The table is the authority — these checks can be skipped (a read
// that failed says nothing, see below) or outrun by a close committing in
// between — so the same conditions arrive as trigger errors, and a caller who
// hits the race deserves the same answer as one who does not.
const CLOSED_DEPOSIT = 'That deposit has been closed — link a live deposit instead.'
const HANDED_OVER = 'That book has handed over to a successor — link the successor instead.'

// Maps a write refused by enforce_recurring_link_not_handed_over onto the
// message and status the validator would have given. Without it these land in
// the generic catch-alls: "Failed to create recurring saving" (500 — reads as a
// server fault for a request the server understood perfectly) and "Recurring
// saving not found" (404 — reads as a missing row, the error-vs-not-found
// conflation #532/#533 exists to stop).
export function linkRefusalMessage(error: { message?: string } | null): string | null {
  const message = error?.message ?? ''
  if (message.includes('closed deposit:')) return CLOSED_DEPOSIT
  if (message.includes('successor book:')) return HANDED_OVER
  return null
}

// Validate a recurring saving's `linked_deposit_tx_id`. The FK only enforces that
// the transaction exists (globally), and RLS on recurring_savings only checks the
// recurring row's own user_id — so without this an authenticated caller could
// point a link at another user's transaction (an existence probe) or at a
// deposit in a different goal (a cross-goal link that can never resolve). Both
// degrade gracefully in the combine flow, but we reject them at write time so the
// stored link is always meaningful.
//
// Returns a 400-worthy error message, or null when the link is valid. The
// owner scope (.eq user_id) means a foreign tx reads as "not found" — no leak.
export async function validateLinkedDeposit(
  supabase: SupabaseClient,
  userId: string,
  txId: string,
  recurringGoalId: string | null,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('investment_transactions')
    .select('asset_type, interest_rate, expiry_date, goal_id, transaction_type, deposit_group_id, successor_deposit_tx_id, amount_vnd')
    .eq('transaction_id', txId)
    .eq('user_id', userId)
    .single()
  if (error || !data) return 'Linked deposit not found.'
  if (
    data.asset_type !== 'bank' ||
    data.transaction_type !== 'investment' ||
    data.interest_rate == null ||
    !data.expiry_date
  ) {
    return 'Linked deposit must be a bank term deposit.'
  }
  // A link may target a single term deposit (combine at maturity) or an
  // accumulating book (auto top-up each month). For a book, only its ANCHOR is a
  // valid target — deposit_group_id = its own id — so the link points at the book
  // as a whole and survives a collapse (the collapse re-points links to the
  // surviving anchor). A non-anchor tranche is not a linkable target.
  if (data.deposit_group_id != null && data.deposit_group_id !== txId) {
    return 'Link an accumulating book via its anchor deposit.'
  }
  // A book that has handed over refuses every contribution from here on (#638),
  // so a link pointing at it could never be funded — and the monthly plan would
  // answer the Saved pill with "it already has a successor" and nothing else.
  if (data.successor_deposit_tx_id) {
    return HANDED_OVER
  }
  if ((data.goal_id ?? null) !== (recurringGoalId ?? null)) {
    return 'Linked deposit must belong to the same goal as the recurring saving.'
  }
  // A deposit that has been fully withdrawn — a closed term deposit, or a book
  // settled whole (which also clears deposit_group_id, so the anchor check above
  // waves it through) — can never take another đồng. The plan would keep asking
  // for a month it has nowhere to put, and the top-up fails with "accumulating
  // book not found". The table refuses this too (#650); this is the readable half.
  //
  // Asked of the BOOK when the target is a book anchor: a link names the anchor
  // but funds the whole group, and a partial withdrawal can empty that one
  // tranche while the book carries on. Reading the anchor alone would refuse a
  // link to a book that is still live.
  //
  // A read that FAILS says nothing about the balance, so it must not be counted
  // as one. Normalising either query to an empty result would report a live book
  // as closed — a 400 on a request that was perfectly valid, during a blip a
  // retry would clear. The table refuses a genuinely closed target either way
  // (that guard is the authoritative one), so the honest move when this cannot
  // be judged is to say nothing and let the write be judged there.
  const isBookAnchor = data.deposit_group_id === txId
  let group: Array<{ transaction_id: string; amount_vnd: number }>
  if (isBookAnchor) {
    const { data: tranches, error: groupError } = await supabase
      .from('investment_transactions')
      .select('transaction_id, amount_vnd')
      .eq('user_id', userId)
      .eq('deposit_group_id', txId)
      .eq('transaction_type', 'investment')
      .is('renewed_from_transaction_id', null)
    if (groupError) return null
    group = tranches ?? []
  } else {
    group = [{ transaction_id: txId, amount_vnd: data.amount_vnd }]
  }

  const ids = group.map((t) => t.transaction_id)
  if (!ids.length) return null
  const { data: withdrawals, error: withdrawalError } = await supabase
    .from('investment_transactions')
    .select('principal_withdrawn, asset_type, fund_id')
    .eq('user_id', userId)
    .in('parent_transaction_id', ids)
    .eq('transaction_type', 'withdrawal')
  if (withdrawalError) return null

  const held = group.reduce((sum, t) => sum + (t.amount_vnd ?? 0), 0)
  // A row keyed by a fund draws on that (goal, fund) bucket, not on the deposit
  // it names as parent — the precedence check_withdrawal_balance applies (#606).
  // Counted here, a fund sale big enough would report a live deposit as closed
  // and refuse a link that the table would have accepted.
  const withdrawn = (withdrawals ?? [])
    .filter((w) => !(w.asset_type === 'fund' && w.fund_id != null))
    .reduce((sum, w) => sum + (w.principal_withdrawn ?? 0), 0)
  if (held - withdrawn <= 0) {
    return CLOSED_DEPOSIT
  }
  return null
}
