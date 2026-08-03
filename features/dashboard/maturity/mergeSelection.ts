// The merge half of the maturity-resolve flow (#602).
//
// These rules ran inline inside MaturityResolveBody, under its 25 useState
// calls — so whether "tất toán & giữ chờ gộp" is offered at all, and what the
// new deposit's provenance line claims, could only be checked by rendering the
// whole sheet. They are pure functions of the anchor and its siblings.

import { classifyMergeSources } from '@/lib/mergeEligibility'
import type { InvRow } from '../contracts'

/** The eligibility shape the shared predicate reads off a row. */
function asSource(r: InvRow) {
  return {
    id: r.id, type: r.type, expiryDate: r.expiryDate, principal: r.principal,
    value: r.value, depositGroupId: r.depositGroupId, currency: r.currency,
    isPledged: r.isPledged,
  }
}

/**
 * Siblings this deposit could be settled-with-hold against, nearest maturity
 * first.
 *
 * Settle-with-hold pools this deposit's cash inside the goal until a LATER
 * sibling matures and absorbs it. So an anchor must (a) mature later, (b) be a
 * plain positive bank deposit, and (c) accept this deposit as an eligible merge
 * source under the same window/currency/pledged rules the merge sheet uses —
 * checked with the roles reversed: the sibling as anchor, this deposit as the
 * source. No anchor means no hold fork; the sheet offers a plain withdraw.
 *
 * Never offered for an unassigned deposit (the pool is goal-scoped) or for an
 * accumulating book (it settles as a whole).
 */
export function holdAnchorsFor(
  inv: InvRow,
  siblingDeposits: InvRow[] | undefined,
  goalId: string | null | undefined,
  isBook: boolean,
  windowDays: number,
): InvRow[] {
  if (goalId == null || isBook) return []
  return (siblingDeposits ?? [])
    .filter((s) => s.id !== inv.id && s.type === 'bank' && !s.depositGroupId && (s.principal ?? s.value ?? 0) > 0)
    .filter((s) => (s.expiryDate ?? '') > (inv.expiryDate ?? ''))
    .filter((s) => classifyMergeSources(asSource(s), [asSource(inv)], windowDays)[0]?.eligible)
    .sort((a, b) => (a.expiryDate ?? '').localeCompare(b.expiryDate ?? ''))
}

export interface MergeProvenance {
  /** "N nguồn" — the anchor plus every folded source. */
  sourceCount: number
  /** "M ngân hàng" — distinct real banks among them. */
  bankCount: number
  isMultiSource: boolean
}

/**
 * What the merged deposit's provenance line may claim. A NULL bank_code (a
 * legacy deposit with no bank recorded) is excluded from the bank count, so the
 * line never names a bank the user never set.
 */
export function mergeProvenance(inv: InvRow, selectedSources: InvRow[]): MergeProvenance {
  const banks = new Set<string>()
  if (inv.bankCode) banks.add(inv.bankCode)
  selectedSources.forEach((s) => { if (s.bankCode) banks.add(s.bankCode) })
  return {
    sourceCount: selectedSources.length + 1,
    bankCount: banks.size,
    isMultiSource: selectedSources.length > 1,
  }
}

/**
 * What a source's "received" field prefills to: its current value. The user
 * edits it down to the real cash when settling early is penalised.
 */
export function defaultReceivedFor(s: InvRow): number {
  return Math.round(s.value ?? s.principal ?? 0)
}
