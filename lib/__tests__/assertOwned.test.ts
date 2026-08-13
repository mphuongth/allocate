import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { archivedGoalError } from '../assertOwned'

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
