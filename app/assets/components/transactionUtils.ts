// Shared types + pure helpers for the dashboard Recent activity card and the
// "View all" transaction ledger. Both render rows from the same
// /api/v1/investment-transactions shape, so the display logic lives here.

export interface LedgerTransaction {
  transaction_id: string
  goal_id: string | null
  asset_type: string | null
  transaction_type?: string
  investment_date: string
  amount_vnd: number
  unit_price: number | null
  units: number | null
  interest_rate: number | null
  expiry_date: string | null
  fund_id: string | null
  bank_code?: string | null
  notes: string | null
  principal_withdrawn?: number | null
  units_withdrawn?: number | null
  // "Ví chờ gộp": a withdrawal that PARKED its cash for a future merge rather than
  // spending it. consumed_by_inv_id is set once the merge folds it in.
  held_for_merge?: boolean | null
  consumed_by_inv_id?: string | null
  merge_anchor_inv_id?: string | null
  savings_goals?: { goal_name: string } | null
  funds?: { id: string; name: string; nav: number } | { id: string; name: string; nav: number }[] | null
  // The `notes` of the row `parent_transaction_id` points at — the deposit this
  // withdrawal drew from. A withdrawal itself carries no notes (SellWithdrawSheet
  // posts only parent_transaction_id, amount and principal), so without this it
  // named nothing more specific than its asset type ("Ngân hàng"). The API
  // attaches it with one batched lookup; a renewal re-parents a closed cycle's
  // withdrawal rows onto that cycle's history SNAPSHOT (20260815000001,
  // 20260904000001), so this is the name the source had at withdrawal time, not
  // necessarily the live deposit's name today.
  parentNotes?: string | null
}

export const ASSET_TYPES = ['fund', 'bank', 'stock', 'gold'] as const
export type AssetType = (typeof ASSET_TYPES)[number]

// The funds relation can come back as an object or a single-element array
// depending on the Supabase join shape — normalize to the fund name.
function fundNameOf(tx: LedgerTransaction): string | null {
  const f = tx.funds
  if (!f) return null
  const fund = Array.isArray(f) ? f[0] : f
  return fund?.name ?? null
}

export function isWithdrawal(tx: LedgerTransaction): boolean {
  return tx.transaction_type === 'withdrawal'
}

// Could a recurring saving be pointing at this row (#655)? Only a bank
// investment can: `validateLinkedDeposit` refuses every other asset type and
// refuses withdrawals outright. Deleting a fund, gold, stock or withdrawal
// therefore cannot unlink anything, and asking about it buys a
// guaranteed-empty answer that the delete now waits on.
//
// Deliberately looser than that validator, which also requires a rate and a
// maturity: an edit can clear either after the link was made, and a link that
// outlived the check is exactly the case the warning exists for. This screens
// out only what no edit could turn back into a linkable deposit.
export function mayCarryRecurringLink(tx: LedgerTransaction): boolean {
  return tx.asset_type === 'bank' && !isWithdrawal(tx)
}

// The display semantics of a row, beyond plain investment/withdrawal. A held-for-
// merge settlement is a withdrawal whose cash was PARKED for a future merge, not
// spent — so it must read NEUTRALLY (no red "−" loss) everywhere it appears
// (History tab, Recent activity, ledger). Once the merge consumes it
// (consumed_by_inv_id set), it reads as "merged". Centralizing this here is the
// whole fix: all three surfaces branch on transaction_type alone today.
export type TxKind = 'investment' | 'withdrawal' | 'held' | 'consumed'

// The minimal row shape txKind needs — both LedgerTransaction (card/ledger) and
// the goal-detail history rows satisfy it structurally.
export interface TxKindFields {
  transaction_type?: string
  held_for_merge?: boolean | null
  consumed_by_inv_id?: string | null
}

export function txKind(tx: TxKindFields): TxKind {
  if (tx.transaction_type !== 'withdrawal') return 'investment'
  // Where the cash went decides the tone, not which path parked it. A book
  // folded into its successor (#638) closes every tranche with a withdrawal that
  // carries consumed_by_inv_id and no held_for_merge — the money went straight
  // into the new book, but the row read as red spending, so a merged book looked
  // like the account had been emptied.
  if (tx.consumed_by_inv_id != null) return 'consumed'
  if (tx.held_for_merge === true) return 'held'
  return 'withdrawal'
}

export interface TxDir {
  kind: TxKind
  // Semantic tone the row renders in: gains positive, spends negative, held/merged
  // neutral. Each surface maps this to its own color tokens.
  tone: 'pos' | 'neg' | 'muted'
  // Amount prefix. Held/merged carry NO sign — the cash isn't a loss, it's parked.
  sign: '+' | '−' | ''
}

export function txDir(tx: TxKindFields): TxDir {
  const kind = txKind(tx)
  if (kind === 'investment') return { kind, tone: 'pos', sign: '+' }
  if (kind === 'withdrawal') return { kind, tone: 'neg', sign: '−' }
  return { kind, tone: 'muted', sign: '' } // held / consumed — neutral, parked cash
}


// Primary label shown in a row: the fund name for funds, otherwise the notes,
// otherwise — for a withdrawal only — the name of the source it drew from,
// falling back to the asset-type label provided by the caller (i18n lives in
// the component).
//
// A BANK withdrawal inverts that last pair: the source's name outranks the
// row's own note. A withdrawal's own note describes the ACTION ("Rút để gộp
// gửi"), not where the money came from, and that action note used to bury the
// bank name every other row in the ledger identifies itself by. Gold is left
// out of the swap — its notes field already carries the provider (e.g. "PNJ")
// set at creation, not an after-the-fact note, so it has nothing to invert.
export function txPrimaryName(tx: LedgerTransaction, assetLabel: string): string {
  const fund = fundNameOf(tx)
  if (fund) return fund

  if (isWithdrawal(tx)) {
    const parentName = tx.parentNotes?.trim() || ''
    const ownNotes = tx.notes?.trim() || ''
    if (tx.asset_type === 'bank' && parentName) return parentName
    return ownNotes || parentName || assetLabel
  }

  return (tx.notes?.trim() || '') || assetLabel
}

export function fmtTxDate(d: string, locale: string): string {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}
