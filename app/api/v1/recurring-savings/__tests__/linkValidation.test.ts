import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { linkRefusalMessage, validateLinkedDeposit } from '../linkValidation'

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

// The validator says nothing when it cannot judge — a failed balance read is not
// evidence of a closed deposit — and it can be outrun by a close committing
// between the check and the write. Both land as a trigger refusal on the write,
// which the routes used to report as 500 (POST) and 404 (PUT): a server fault,
// and a missing row, for a request that was neither.
describe('linkRefusalMessage', () => {
  it('recognises a deposit the table refused as closed', () => {
    expect(linkRefusalMessage({ message: 'closed deposit: that deposit has been closed, so a link to it could never be funded' }))
      .toMatch(/closed/i)
  })

  it('recognises a book that has handed over', () => {
    expect(linkRefusalMessage({ message: 'successor book: that book has handed over to a successor, so link the successor instead' }))
      .toMatch(/successor/i)
  })

  it('leaves an unrelated failure to the caller, so a genuine fault still reads as one', () => {
    expect(linkRefusalMessage({ message: 'could not connect to server' })).toBeNull()
    expect(linkRefusalMessage(null)).toBeNull()
  })
})

// Two shapes the validator got wrong on the way to the balance, both of which
// end in a 400 on a link the table would have taken.
describe('validateLinkedDeposit — reading the target correctly', () => {
  type Row = Record<string, unknown>

  // The real call sequence: the target (.single()), then — for a book anchor —
  // its tranches, then the withdrawals against them.
  function bookClient(target: Row, tranches: Row[], withdrawals: Row[]): SupabaseClient {
    let awaited = 0
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      is: () => chain,
      single: async () => ({ data: target, error: null }),
      then: (resolve: (v: unknown) => void) => {
        awaited += 1
        return resolve({ data: awaited === 1 ? tranches : withdrawals, error: null })
      },
    }
    return { from: () => chain } as unknown as SupabaseClient
  }

  // validateUUID preserves the case it was given, while PostgREST answers in
  // canonical lowercase — so a strict === misread an anchor as a plain deposit,
  // measured the (empty) anchor tranche alone, and refused a live book.
  it('recognises a book anchor whose id arrived in uppercase', async () => {
    const lower = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    const result = await validateLinkedDeposit(
      bookClient(
        { ...DEPOSIT, deposit_group_id: lower, amount_vnd: 1_000_000 },
        [{ transaction_id: lower, amount_vnd: 1_000_000 }, { transaction_id: 'tranche-2', amount_vnd: 2_000_000 }],
        [{ principal_withdrawn: 1_000_000, asset_type: 'bank', fund_id: null }],
      ),
      'user-1',
      lower.toUpperCase(),
      'goal-1',
    )
    expect(result).toBeNull()
  })

  // A renewal snapshot is the cycle that ended. Its amount_vnd is still sitting
  // on the row, so reading it as fundable let a saving point at closed history —
  // and the ids are handed out, under include_history.
  it('refuses a renewal snapshot', async () => {
    const result = await validateLinkedDeposit(
      bookClient({ ...DEPOSIT, renewed_from_transaction_id: 'tx-live' }, [], []),
      'user-1',
      'tx-old',
      'goal-1',
    )
    expect(result).toMatch(/closed/i)
  })

  // ...and the deposit it renewed into is still a perfectly good target, so the
  // refusal above is about history and not about renewed deposits in general.
  it('accepts the deposit a snapshot renewed into', async () => {
    const result = await validateLinkedDeposit(
      bookClient({ ...DEPOSIT, renewed_from_transaction_id: null }, [], []),
      'user-1',
      'tx-live',
      'goal-1',
    )
    expect(result).toBeNull()
  })
})
