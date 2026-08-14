import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { archivedGoalError, completedGoalError } from '../assertOwned'

// The front half of "a finished goal takes no new money" (#650). The database
// trigger is the authoritative guard; this exists so the caller reads a 409 that
// says what to do instead of a 500 from a write that was already doomed.

const client = (result: { data: unknown; error: unknown }) => {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => result,
  }
  return { from: () => chain } as unknown as SupabaseClient
}

describe('completedGoalError', () => {
  // The back half: routes that reach the ledger without asking first used to
  // report the trigger's refusal as "Failed to create investment" (a 500 for a
  // valid request) or "Transaction not found" (a 404 about a row that is there).
  it('turns the database refusal into an answer the caller can act on', async () => {
    const res = completedGoalError({ message: 'completed goal: this goal has been finished, so its transactions are settled — reopen it to change them' })
    expect(res?.status).toBe(409)
    const body = await res!.json()
    expect(body.code).toBe('goal_completed')
    expect(body.error).toMatch(/^this goal has been finished/)
  })

  it('passes every other error through untouched', () => {
    expect(completedGoalError({ message: 'withdrawal invariant: something else' })).toBeNull()
    expect(completedGoalError(null)).toBeNull()
    expect(completedGoalError(undefined)).toBeNull()
    expect(completedGoalError({})).toBeNull()
  })
})

describe('archivedGoalError', () => {
  it('lets an active goal through', async () => {
    expect(await archivedGoalError(client({ data: { completed_at: null }, error: null }), 'g1', 'u1')).toBeNull()
  })

  it('refuses an archived goal with the way out', async () => {
    const res = await archivedGoalError(
      client({ data: { completed_at: '2026-08-13T00:00:00Z' }, error: null }), 'g1', 'u1')
    expect(res?.status).toBe(409)
    const body = await res!.json()
    expect(body.code).toBe('goal_completed')
    expect(body.error).toMatch(/Reopen it first/)
  })

  it('leaves a foreign goal to the ownership check that runs first', async () => {
    // Scoped by user_id, so a goal that is not the caller's reads as no row.
    // Answering 403 here too would only duplicate a refusal already made.
    expect(await archivedGoalError(client({ data: null, error: null }), 'g1', 'u1')).toBeNull()
  })

  it('does not read a failed lookup as an active goal', async () => {
    const res = await archivedGoalError(client({ data: null, error: { message: 'boom' } }), 'g1', 'u1')
    expect(res?.status).toBe(500)
  })
})
