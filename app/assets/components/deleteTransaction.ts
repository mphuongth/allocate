// Every reason DELETE /api/v1/investment-transactions/:id can refuse, plus the
// two the client decides for itself. The route returns these verbatim; the UI
// maps them to translated strings rather than showing the server's English.
export type DeleteFailureCode =
  | 'settlement_consumed'   // this row is a settlement already merged elsewhere
  | 'merge_target'          // another settlement has been merged INTO this deposit
  | 'settlement_pending'    // a settlement is held, waiting to merge into this one
  | 'referenced'            // some other record still points at this row
  | 'withdrawal_invariant'  // a withdrawal still draws on this holding (#608)
  | 'renewal_history'       // this deposit's closed cycles still point at it
  | 'book_anchor'           // an accumulating book's later instalments are filed under it
  | 'not_found'             // already gone
  | 'delete_failed'         // the server tried and failed
  | 'network'               // the request never got an answer
  | 'unknown'               // a response we don't recognise

export type DeleteResult = { ok: true } | { ok: false; code: DeleteFailureCode }

// Delete a transaction and report *why* if it was refused.
//
// Both call sites used to do `if (res.ok) { … }` with no else, so a 409 made the
// button do nothing and say nothing — the worst rendering of "here is what to do
// instead" (#550). Three of the refusals are user-actionable and each needs its
// own instruction, so a boolean can't carry the answer.
//
// A rejected fetch is deliberately its own code: the server never got to decide,
// so reporting a specific refusal would be inventing one.
export async function deleteTransaction(txId: string): Promise<DeleteResult> {
  let res: Response
  try {
    res = await fetch(`/api/v1/investment-transactions/${txId}`, { method: 'DELETE' })
  } catch {
    return { ok: false, code: 'network' }
  }

  if (res.ok) return { ok: true }

  // An error body isn't guaranteed to be JSON — a gateway can answer HTML.
  try {
    const body = await res.json()
    const code = body?.code
    return { ok: false, code: isFailureCode(code) ? code : 'unknown' }
  } catch {
    return { ok: false, code: 'unknown' }
  }
}

// Keep in step with DeleteFailureCode AND with messages/*.json: a code the route
// returns but this list omits falls through to 'unknown', so the toast says
// "couldn't delete this transaction" in place of the instruction the refusal was
// added to give. That is how withdrawal_invariant arrived — the route mapped it,
// the client did not, and the actionable half of the change was invisible.
export const DELETE_FAILURE_CODES: readonly DeleteFailureCode[] = [
  'settlement_consumed', 'merge_target', 'settlement_pending',
  'referenced', 'withdrawal_invariant', 'renewal_history', 'book_anchor', 'not_found', 'delete_failed', 'network', 'unknown',
]

function isFailureCode(v: unknown): v is DeleteFailureCode {
  return typeof v === 'string' && (DELETE_FAILURE_CODES as readonly string[]).includes(v)
}
