// Money math for withdrawing from a bank savings book.
//
// The withdrawal sheet used to treat the entered amount as a slice of the
// deposit's *current value* — principal plus projected interest — and then apply
// that fraction to the principal:
//
//   const bankFraction = numAmount / item.currentValue
//   const bankPrincipalPortion = Math.round(principal * bankFraction)
//
// so the principal it previewed and posted was never the number the user typed
// (#578). A user withdrawing 4,365,100 of principal had 4,333,849 recorded, and
// lib/depositValuation subtracted that short figure from the holding, leaving the
// remaining balance overstated for good.
//
// The entered amount IS the principal leaving the book. Interest is whatever the
// bank paid on top of it — which the user reads off their slip, because an early
// withdrawal can forfeit accrued interest entirely.

export interface BankWithdrawalInput {
  /** Principal still in the book, before this withdrawal. */
  currentPrincipal: number
  /** Principal the user is withdrawing. */
  amount: number
  /** Cash the bank actually paid out. */
  received: number
}

export interface BankWithdrawalPreview {
  /** Principal removed from the book — exactly what the user entered. */
  principal: number
  received: number
  /** received − principal. Negative when an early withdrawal costs money. */
  interest: number
  remainingPrincipal: number
  /** The book doesn't hold this much principal — the confirm is blocked. */
  exceedsPrincipal: boolean
}

export function previewBankWithdrawal({ currentPrincipal, amount, received }: BankWithdrawalInput): BankWithdrawalPreview {
  const principal = Math.round(amount)
  const paid = Math.round(received)
  return {
    principal,
    received: paid,
    interest: paid - principal,
    remainingPrincipal: Math.max(0, currentPrincipal - principal),
    exceedsPrincipal: principal > currentPrincipal,
  }
}

/**
 * Prefill for the "amount you'll receive" field: the principal being withdrawn
 * plus its share of the interest accrued so far.
 *
 * The amount field is principal, so without adding the interest back an unedited
 * field would record a withdrawal that earned nothing. At a full withdrawal this
 * returns the whole current value, which is what the received field was
 * pre-filled with before #578 — the user still edits it down when an early
 * withdrawal cuts the interest.
 */
export function estimateReceivedForPrincipal({ currentPrincipal, currentValue, amount }: {
  currentPrincipal: number
  currentValue: number
  amount: number
}): number {
  const principal = Math.round(amount)
  if (currentPrincipal <= 0) return principal
  // A savings book cannot accrue negative interest: a current value below the
  // principal is stale data, and guessing a loss would understate the payout.
  const accrued = Math.max(0, currentValue - currentPrincipal)
  // An amount above the remaining principal is already flagged as invalid; cap
  // the estimate at what the book is worth rather than inventing a bigger payout.
  const capped = Math.min(principal, currentPrincipal)
  return capped + Math.round(accrued * (capped / currentPrincipal))
}
