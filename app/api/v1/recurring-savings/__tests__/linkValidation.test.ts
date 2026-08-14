import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { validateLinkedDeposit } from '../linkValidation'

// The readable half of "a link must point at a live deposit" (#650) — the table
// refuses it either way, but this is what the user is told. It measures the
// deposit's balance, so it inherits the ledger's key precedence: a withdrawal
// keyed by a fund draws on that (goal, fund) bucket and NOT on the deposit it
// names as parent (#606). Charged to the deposit, a fund sale large enough turns
// a perfectly live deposit into "closed" and refuses a link the database would
// have taken.

const DEPOSIT = {
  asset_type: 'bank',
  interest_rate: 5,
  expiry_date: '2027-01-01',
  goal_id: 'goal-1',
  transaction_type: 'investment',
  deposit_group_id: null,
  successor_deposit_tx_id: null,
  amount_vnd: 4_000_000,
}

type Withdrawal = { principal_withdrawn: number; asset_type: string | null; fund_id: string | null }

// Two queries for a single term deposit: the target (.single()) and the
// withdrawals against it (awaited directly).
function client(withdrawals: Withdrawal[]): SupabaseClient {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    is: () => chain,
    single: async () => ({ data: DEPOSIT, error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ data: withdrawals, error: null }),
  }
  return { from: () => chain } as unknown as SupabaseClient
}

describe('validateLinkedDeposit — a fund sale is not a withdrawal from the deposit it names', () => {
  it('accepts a link when the only "withdrawal" against the deposit is a fund sale', async () => {
    const result = await validateLinkedDeposit(
      client([{ principal_withdrawn: 5_000_000, asset_type: 'fund', fund_id: 'fund-1' }]),
      'user-1',
      'tx-1',
      'goal-1',
    )
    expect(result).toBeNull()
  })

  it('still refuses a link to a deposit an ordinary withdrawal has emptied', async () => {
    const result = await validateLinkedDeposit(
      client([{ principal_withdrawn: 4_000_000, asset_type: 'bank', fund_id: null }]),
      'user-1',
      'tx-1',
      'goal-1',
    )
    expect(result).toMatch(/closed/i)
  })

  // asset_type is nullable and the route lets a caller omit it, and the fund key
  // needs both halves — a row carrying a fund_id alone is keyed by its parent.
  it('counts a row that has a fund_id but is not fund-typed', async () => {
    const result = await validateLinkedDeposit(
      client([{ principal_withdrawn: 4_000_000, asset_type: null, fund_id: 'fund-1' }]),
      'user-1',
      'tx-1',
      'goal-1',
    )
    expect(result).toMatch(/closed/i)
  })
})
