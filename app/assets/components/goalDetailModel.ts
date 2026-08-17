// Pure goal-detail model logic (#467): the deadline/goal-calculator projection and
// the transaction-history row descriptor. Split out of goalDetailShared so that
// shared UI file stays presentational and this pure logic can be tested/reused on
// its own.
import { RefreshCw, PiggyBank, GitMerge, ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react'
import { txKind, type TxKind, type TxKindFields } from './transactionUtils'
import { monthsUntilYm, businessYearMonth } from '@/lib/dates'

export interface HistoryRowDescriptor {
  kind: TxKind
  ink: string
  fill: string
  Icon: LucideIcon
  sign: string
  name: string
}

// How a transaction-history row presents (#467): its kind → colour tokens, icon,
// amount sign and display name. A held/merged settlement or a renewed row reads
// NEUTRALLY (muted, no red "−") because the cash was parked/rolled forward, not
// spent. Byte-identical inline in both goal-detail surfaces before this; each now
// calls it and only maps the icon size + chrome in its own JSX.
export function describeHistoryRow(
  tx: TxKindFields & { fund_name?: string | null; notes?: string | null },
  isRenewed: boolean,
  isVi: boolean,
): HistoryRowDescriptor {
  const kind = txKind(tx)
  const isWithdraw = kind === 'withdrawal'
  const neutral = isRenewed || kind === 'held' || kind === 'consumed'
  const ink = neutral ? 'var(--c-muted)' : isWithdraw ? 'var(--c-neg)' : 'var(--c-pos)'
  const fill = neutral ? 'var(--c-card-2)' : isWithdraw ? 'var(--c-neg-tint)' : 'var(--c-pos-tint)'
  const Icon = isRenewed ? RefreshCw : kind === 'held' ? PiggyBank : kind === 'consumed' ? GitMerge : isWithdraw ? ArrowDownRight : ArrowUpRight
  const sign = isWithdraw ? '-' : kind === 'investment' ? '+' : ''
  const name = tx.fund_name ?? tx.notes ?? (isVi ? 'Khoản đầu tư' : 'Investment')
  return { kind, ink, fill, Icon, sign, name }
}

/**
 * "Gộp từ <sổ A>" for a row another book paid for (#638 Phase 4, #656), or null.
 *
 * The same sentence the live book's top-up strip shows, said on a History row.
 * That strip is where this started, and it does not survive the successor's own
 * renewal: the credited tranche is deleted and the anchor's deposit_group_id is
 * cleared, so the book stops rendering as a book at all. The marker rides onto
 * the renewal snapshot instead (20260817000002), and this is where it is read.
 *
 * `names` is the page's book-name map. A merged source is DISSOLVED, so nothing
 * points at it through deposit_group_id any more and it can easily be off the
 * page; useGoalDetailData backfills those by id, but a miss must still read as
 * provenance — "Merged from undefined" would look like a bug in the ledger
 * rather than a name this page happens not to have.
 */
export function mergedFromLabel(
  tx: { merged_from_book_id?: string | null },
  names: Record<string, string>,
  isVi: boolean,
): string | null {
  const id = tx.merged_from_book_id
  if (!id) return null
  const name = names[id]
  if (!name) return isVi ? 'Gộp từ một sổ khác' : 'Merged from another book'
  return isVi ? `Gộp từ ${name}` : `Merged from ${name}`
}

export function calcDeadlineMonths(targetDate: string | null): number {
  if (!targetDate) return 12
  return monthsUntilYm(targetDate)
}

export interface GoalCalculator {
  remaining: number
  monthsLeft: number
  neededPerMonth: number
  monthsToGoal: number | null
  projectedDate: Date | null
  isOnTrack: boolean
  gap: number
}

// The "what will it take" projection shown under both goal-detail surfaces (#467).
// The two views parse their own input differently (mobile from a comma-formatted
// string, desktop from a plain number), so `monthlyInput` arrives already parsed;
// everything downstream — how much is left, the minimum per month to hit the
// deadline, when this pace reaches the goal, and whether it's on track — is shared.
// `monthsToGoal` is null when there's nothing to project (no input or goal met);
// the mobile view maps that to its 0-based `projectedMonths` at the call site.
export function computeGoalCalculator(
  goal: { targetAmount?: number | null; targetDate?: string | null; currentValue: number },
  monthlyInput: number,
): GoalCalculator {
  const remaining = Math.max(0, (goal.targetAmount ?? 0) - goal.currentValue)
  const monthsLeft = calcDeadlineMonths(goal.targetDate ?? null)
  const neededPerMonth = remaining > 0 ? remaining / monthsLeft : 0
  const input = Math.max(0, monthlyInput || 0)
  const monthsToGoal = input > 0 && remaining > 0 ? Math.ceil(remaining / input) : null
  // Anchored to the FIRST of the month, because this date is only ever rendered as
  // a month and year. Adding months to today overflows whenever today's day doesn't
  // exist in the target month — 31 February rolls into March — and the user is then
  // told a month later than their pace actually reaches the goal. Only bites on the
  // 29th-31st, which is why it survived this long.
  // Counted forward from the *business* month, not the browser's local one (#591).
  const projectedDate = monthsToGoal != null
    ? (() => { const { year, month } = businessYearMonth(); return new Date(year, month - 1 + monthsToGoal, 1) })()
    : null
  const isOnTrack = input > 0 && input >= neededPerMonth
  const gap = Math.abs(neededPerMonth - input)
  return { remaining, monthsLeft, neededPerMonth, monthsToGoal, projectedDate, isOnTrack, gap }
}
