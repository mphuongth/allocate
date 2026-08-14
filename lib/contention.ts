import { NextResponse } from 'next/server'

// Two writers reached the same rows and Postgres broke the tie by aborting one.
// Nothing is wrong with the request and NOTHING WAS WRITTEN, so the answer is
// "try again": a 500 reads as a bug and gives the client no reason to retry.
// supabase-js surfaces the SQLSTATE as error.code, so this is a discriminated
// map rather than a match on message text.
//
//   40P01 deadlock_detected      — two writers took the same rows in opposite orders
//   55P03 lock_not_available     — a NOWAIT/timeout writer got there first
//   40001 serialization_failure  — a solvency check's own retry signal
//
// First written inline in fund-investments/assign (#610); shared once a second
// path could hit it. A deposit book is one: closing the whole book locks the
// anchor and then each tranche, while an ordinary withdrawal from a tranche holds
// that tranche (check_withdrawal_balance) and then waits for the anchor in the
// recurring-link unlinker (#650). Opposite orders, and neither lock is optional —
// the BEFORE trigger owns the tranche, so no order the unlinker could take would
// suit both callers. The cycle is left in place and answered honestly instead.
const RETRYABLE_SQLSTATES = new Set(['40P01', '55P03', '40001'])

export function isContention(error: { code?: string } | null | undefined): boolean {
  return RETRYABLE_SQLSTATES.has(error?.code ?? '')
}

/**
 * A 409 for a write two callers contended over, or null when the error is a
 * genuine one for the caller to handle. `code` is what the client keys off.
 */
export function contentionError(
  error: { code?: string; message?: string } | null | undefined,
  message: string,
  code: string,
): NextResponse | null {
  if (!isContention(error)) return null
  console.warn('contention:', code, error?.code)
  return NextResponse.json({ error: message, code }, { status: 409 })
}
