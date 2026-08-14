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
  /**
   * Nothing could say what this is worth today, so there is no prefill to
   * offer and the user has to state the cash themselves. Gold with no price
   * configured: the valuation falls back to what it COST, and a prefill is the
   * figure most users accept unchanged.
   */
  unpriced?: boolean
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

/** One row of the server's own enumeration of what a goal still holds. */
export interface ServerHolding {
  key: string
  kind: string
  asset_type: string | null
  principal: number | null
  units: number | null
  name: string | null
  /** What it is worth today, from the dashboard valuation. Absent = unknown. */
  value?: number | null
}

/**
 * What each of a goal's holdings is worth today, keyed the way the finish keys
 * them.
 *
 * Built from the dashboard payload — the ONE valuation — rather than recomputed:
 * a fund is units × NAV, gold is units × the day's price, a deposit is principal
 * plus accrued interest, and none of that belongs in a second implementation.
 * The overview reads the whole ledger, so unlike the goal-detail page it knows
 * about holdings older than its newest 200 rows.
 */
export function valuationByKey(goal: {
  funds?: Array<{ fundId: string; currentValue: number; quantity: number }>
  nonFunds?: Array<{ transactionId: string; currentValue: number; units: number | null; depositGroupId?: string | null }>
}): Record<string, { value: number; units: number | null }> {
  const out: Record<string, { value: number; units: number | null }> = {}
  for (const f of goal.funds ?? []) {
    out[`fund:${f.fundId}`] = { value: f.currentValue, units: f.quantity }
  }
  for (const nf of goal.nonFunds ?? []) {
    // A book is worth the sum of its tranches, the way the holdings tab rolls
    // them up; everything else is its own row.
    const key = nf.depositGroupId ? `book:${nf.depositGroupId}` : `tx:${nf.transactionId}`
    const prev = out[key]
    out[key] = {
      value: (prev?.value ?? 0) + nf.currentValue,
      units: nf.units == null ? prev?.units ?? null : (prev?.units ?? 0) + nf.units,
    }
  }
  return out
}

function holdingFromRow(row: InvRow): FinishHolding {
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
}

/**
 * The holdings a finish has to liquidate.
 *
 * THE SERVER'S LIST DECIDES which holdings exist. The goal-detail page loads the
 * newest 200 transactions, so on a long-lived goal the older holdings are simply
 * not in `rows` — a plan built from that page would miss their keys and the
 * finish would be refused as incomplete, permanently. The client's view is used
 * only to DISPLAY a holding it happens to have loaded (its name, what it is worth
 * today, the gold price to prefill); a holding the page never saw still appears,
 * priced from what the ledger says it holds.
 *
 * Recurring savings never reach here: they are a plan definition with no
 * transaction to sell (#640), so the server does not enumerate them and they
 * block the finish instead.
 */
export function buildFinishHoldings(rows: InvRow[], server?: ServerHolding[]): FinishHolding[] {
  const byKey = new Map<string, InvRow>()
  for (const row of rows) {
    if (!row.isRecurring) byKey.set(finishHoldingKey(row), row)
  }
  if (!server) return rows.filter((r) => !r.isRecurring).map(holdingFromRow)

  return server.map((h) => {
    // The page supplies how a holding READS — its name, and the asset kind that
    // decides whether the field asks for cash or a unit price.
    const row = byKey.get(h.key)
    const type = row?.type ?? h.asset_type ?? 'bank'
    const name = row?.name ?? h.name ?? h.asset_type ?? h.kind

    // ...but the MONEY is the server's, for every holding and not only for the
    // ones this page never loaded. An accumulating book is rolled up here from
    // the tranches the page happens to hold, so a book with more history than
    // the 200-row window renders short — while the finish liquidates the whole
    // book. Taking the local figure because the key happened to be present
    // would prefill proceeds for the visible tranches only.
    //
    // Cost basis is the last resort, for a holding the valuation had nothing to
    // say about; it is not what a fund or gold is worth.
    const value = Math.round(h.value ?? row?.value ?? Number(h.principal ?? 0))
    const held = h.units != null ? Number(h.units) : row?.units ?? null
    const units = type === 'gold' && held ? held : null
    // Gold with no price configured is valued at what it COST — the overview
    // falls through to the principal branch. Offering that as the sale price is
    // how a purchase price ends up recorded as the day's proceeds, so gold says
    // "I don't know" instead and the user reads the figure off their receipt.
    const unpriced = type === 'gold' && h.value == null
    return {
      key: h.key,
      name,
      type,
      value,
      units,
      input: units ? 'unitPrice' : 'received',
      suggested: units ? Math.round(value / units) : value,
      ...(unpriced ? { unpriced: true } : {}),
    }
  })
}

/**
 * What a holding realizes for the figure typed into its field, or null while that
 * figure is missing or unusable. Null is "not filled in yet", never "zero" — a
 * blank field must not archive the goal on a guess.
 *
 * Zero is unusable too, and deliberately so: a withdrawal's amount_vnd must be
 * positive, so a zero-cash liquidation is refused by the table and rolls the
 * whole finish back. Blocking it here means the user reads that from a disabled
 * button instead of from a failed submit.
 */
export function realizedFor(holding: FinishHolding, raw: string): number | null {
  const trimmed = (raw ?? '').trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n <= 0) return null
  const realized = holding.input === 'unitPrice' ? Math.round(n * (holding.units ?? 0)) : Math.round(n)
  return realized > 0 ? realized : null
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
