// Accumulating ("Loại 2") bank deposits: one logical book topped up over time,
// each top-up a tranche with its own locked-in rate, all sharing the book's
// maturity. A tranche is an investment_transactions row; the book is the set of
// rows sharing a deposit_group_id (the anchor row self-groups). These are the
// pure pieces — grouping the rows and valuing them stays with the callers that
// already hold the withdrawal map (buildInvRows / the overview route), so this
// file never needs the DB or the interest formula.

export function isAccumulating(row: { depositGroupId?: string | null }): boolean {
  return row.depositGroupId != null
}

// The book id a row belongs to: its group when grouped, else itself (a term /
// one-off holding is its own "book of one"). Lets callers group-by uniformly.
export function anchorId(row: { transactionId: string; depositGroupId?: string | null }): string {
  return row.depositGroupId ?? row.transactionId
}

// Amount-weighted average rate across a book's tranches — what the detail view
// shows as "Avg rate / Lãi suất TB". A null tranche rate counts as 0. Returns 0
// when the book holds no principal.
export function blendedRate(tranches: { amount: number; rate: number | null }[]): number {
  const total = tranches.reduce((s, t) => s + t.amount, 0)
  if (total <= 0) return 0
  return tranches.reduce((s, t) => s + t.amount * (t.rate ?? 0), 0) / total
}
