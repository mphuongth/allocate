// The "Liquidate & finish" plan (#650): what the goal still holds, what the user
// must state about each one, and what gets posted.
//
// A finish is a FULL liquidation, so the only thing the sheet asks for is the
// CASH — an early withdrawal forfeits interest, gold sells at the day's price, a
// fund settles at the NAV it settles at. How much of each holding leaves is not a
// choice: it is all of it, and the server recomputes that from the ledger rather
// than trusting these numbers. Which is why this module is about inputs and keys
// only, and carries no valuation of its own.
import type { InvRow } from '@/features/dashboard/contracts'

/** The three columns a finished goal is archived with. */
export interface CompletionSnapshot {
  completedAt?: string | null
  completionValue?: number | null
  completionPercentage?: number | null
}

/**
 * How a finished goal reads, or null while it is still active.
 *
 * A completed goal's live balance is zero — the money was spent on the thing the
 * goal was for — so every surface must render the SNAPSHOT instead of recomputing
 * from holdings that are gone. That is the whole point of persisting it: a
 * withdrawal made afterwards cannot reduce a result that has already been
 * declared.
 */
export function goalCompletion(goal: CompletionSnapshot): { value: number; percentage: number } | null {
  if (!goal.completedAt) return null
  return {
    value: goal.completionValue ?? 0,
    // The database keeps the three columns all-or-nothing, so the fallback is
    // only reached by a payload cached before the field existed.
    percentage: goal.completionPercentage ?? 100,
  }
}

/** What the user has typed, per holding key. */
export type FinishInput = Record<string, string>

export interface FinishHolding {
  /** The server's holding key — see `finishHoldingKey`. */
  key: string
  name: string
  type: string
  /** What the holdings tab says it is worth right now. */
  value: number
  /** Quantity for a holding sold by the unit (gold); null otherwise. */
  units: number | null
  /**
   * 'received'  — the cash the holding pays out, entered whole.
   * 'unitPrice' — the sale price per unit; proceeds are units × price.
   */
  input: 'received' | 'unitPrice'
  /** Prefill for that field, from today's valuation. */
  suggested: number
}

/**
 * How the server groups a holding, and therefore how the plan names it.
 *
 * A fund is keyed by the FUND, not by the row the tab happens to render: the same
 * fund can be split across goals and this goal's purchases dedup into one row, so
 * the sale draws down that whole bucket. A book is keyed by its anchor, because
 * it is closed as one. Everything else is its own transaction.
 */
export function finishHoldingKey(row: InvRow): string {
  if (row.fund) return `fund:${row.fund.fundId}`
  if (row.depositGroupId) return `book:${row.depositGroupId}`
  return `tx:${row.id}`
}

/**
 * The holdings a finish has to liquidate, from the goal-detail rows.
 *
 * Recurring savings are dropped: they are a plan definition, not a transaction —
 * there is nothing to sell, and the synthesized id is a 400 from the withdrawal
 * API (#640). They block the finish instead, named by the blockers endpoint.
 */
export function buildFinishHoldings(rows: InvRow[]): FinishHolding[] {
  return rows.filter((r) => !r.isRecurring).map((row) => {
    const byUnit = row.type === 'gold' && !!row.units && row.units > 0
    return {
      key: finishHoldingKey(row),
      name: row.name,
      type: row.type,
      value: row.value,
      units: byUnit ? row.units : null,
      input: byUnit ? 'unitPrice' : 'received',
      // The price the tab's own valuation used, so an untouched field records
      // today's market rather than an invented number.
      suggested: byUnit ? Math.round(row.value / (row.units as number)) : Math.round(row.value),
    }
  })
}

/**
 * What a holding realizes for the figure typed into its field, or null while that
 * figure is missing or unusable. Null is "not filled in yet", never "zero" — a
 * blank field must not archive the goal on a guess.
 */
export function realizedFor(holding: FinishHolding, raw: string): number | null {
  const trimmed = (raw ?? '').trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 0) return null
  return holding.input === 'unitPrice' ? Math.round(n * (holding.units ?? 0)) : Math.round(n)
}

/** Every holding realized. A goal with nothing left to sell is already complete. */
export function isFinishPlanComplete(holdings: FinishHolding[], inputs: FinishInput): boolean {
  return holdings.every((h) => realizedFor(h, inputs[h.key] ?? '') !== null)
}

/** What the finish brings in, counting only the holdings filled in so far. */
export function totalRealized(holdings: FinishHolding[], inputs: FinishInput): number {
  return holdings.reduce((sum, h) => sum + (realizedFor(h, inputs[h.key] ?? '') ?? 0), 0)
}

/** The request body's plan: one entry per realized holding. */
export function finishPlanFrom(
  holdings: FinishHolding[],
  inputs: FinishInput,
): Array<{ key: string; received: number }> {
  return holdings.flatMap((h) => {
    const received = realizedFor(h, inputs[h.key] ?? '')
    return received == null ? [] : [{ key: h.key, received }]
  })
}
