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
    .select('asset_type, interest_rate, expiry_date, goal_id, transaction_type')
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
  if ((data.goal_id ?? null) !== (recurringGoalId ?? null)) {
    return 'Linked deposit must belong to the same goal as the recurring saving.'
  }
  return null
}
