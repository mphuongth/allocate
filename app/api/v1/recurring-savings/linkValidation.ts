import type { SupabaseClient } from '@supabase/supabase-js'

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
    return 'That book has handed over to a successor — link the successor instead.'
  }
  if ((data.goal_id ?? null) !== (recurringGoalId ?? null)) {
    return 'Linked deposit must belong to the same goal as the recurring saving.'
  }
  // A deposit that has been fully withdrawn — a closed term deposit, or a book
  // settled whole (which also clears deposit_group_id, so the anchor check above
  // waves it through) — can never take another đồng. The plan would keep asking
  // for a month it has nowhere to put, and the top-up fails with "accumulating
  // book not found". The table refuses this too (#650); this is the readable half.
  const { data: withdrawals } = await supabase
    .from('investment_transactions')
    .select('principal_withdrawn')
    .eq('user_id', userId)
    .eq('parent_transaction_id', txId)
    .eq('transaction_type', 'withdrawal')
  const withdrawn = (withdrawals ?? []).reduce((sum, w) => sum + (w.principal_withdrawn ?? 0), 0)
  if (data.amount_vnd - withdrawn <= 0) {
    return 'That deposit has been closed — link a live deposit instead.'
  }
  return null
}
