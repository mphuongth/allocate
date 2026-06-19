# Gộp nhiều nguồn (multi-source deposit merge)

Design: claude.ai/design project `019dfb22-b15f-7643-9c95-53100cda2d29`
(`Gộp nhiều nguồn.html`, sources `multi-merge-screens.jsx`, `multi-merge-desktop.jsx`,
`merge-eligibility.jsx`).

## Context — what already exists

The data-layer core of multi-source merge is **already built**: the combine flow
(`MaturityResolveBody` + RPC `renew_term_deposit_with_merge`, migration
`20260619000001`) already lets the user fold multiple sibling bank deposits + one
recurring saving into a renewal, atomically, with no double-count. The UI already
renders a checkbox per source and an editable total split by `allocateCumulative`.

The gap is **UX, eligibility rules, structured bank, and the holding pool ("Ví chờ
gộp")** — not the merge mechanism.

Schema reality checks:
- `investment_transactions` is **VND-only** (no currency column) and has **no
  pledged/frozen state**. So eligibility rules "same currency" and "not pledged"
  have no data today.
- Bank is currently only free text in `notes`/name.

## Decisions (owner)

1. **Bank = structured `bank_code`** (FK to a small `banks(code, name, logo_url)`
   ref table), not parsed from the deposit name. Name stays free text.
2. **Don't build the multi-currency/pledged epic.** Add two cheap gate fields so the
   eligibility predicates are honest: `currency TEXT DEFAULT 'VND'` and
   `is_pledged BOOLEAN DEFAULT false` (no-op until real pledged products exist).
   "Active/liquidatable" is already derivable — no new column.
3. **Holding pool = flag on the settlement (withdrawal) transaction**, NOT a
   no-interest deposit row (that would leak into NAV / maturity lists / every
   `asset_type='bank'` sweep). Held cash has left the bank product — it is cash.
   Fields: `held_for_merge`, `merge_target_goal_id`, `merge_anchor_inv_id`,
   `consumed_by_inv_id`. The pool = held settlements not yet consumed.

## PRs (independent, increasing risk)

### PR 0 — Foundation: structured bank + gate fields  ← IN PROGRESS
- Migration: `banks(code PK, name, logo_url)` seeded with ~20 common VN banks;
  `investment_transactions.bank_code` (FK, nullable), `currency` (default 'VND'),
  `is_pledged` (default false).
- Overview API + deposit GET return `bankCode`, `currency`.
- Bank selector in AddTransactionSheet (create + edit) for bank deposits;
  `currency`/`is_pledged` default-only (no UI yet).
- Old deposits keep `bank_code = NULL`; every consumer tolerates NULL.
- TDD: form sets `bank_code` in POST/PUT; route accepts + defaults currency;
  overview returns `bankCode`; NULL bank doesn't break render.

### PR 1 — Multi-source combine UX
"Gộp nhiều nguồn" label when >1 source; destination bank picker (`bank_code`,
default = settling deposit's bank); provenance "Gộp từ N nguồn · M ngân hàng"
(distinct `bank_code`, NULL excluded from bank count); success lists sources.

### PR 2 — Eligibility (3 workable rules; currency/pledged now honest)
`lib/mergeEligibility.ts` pure `classifyMergeSources(anchor, siblings, windowDays=7)`:
same goal · liquidatable · |maturity−anchor.maturity| ≤ window · same currency ·
not pledged. Out-of-window ⇒ blocked + "Gộp sớm?" override (received < value =
penalty). UI: eligible (preselected) / blocked (dimmed + reason) + window slider.

### PR 3 — Cluster auto-detection ("Cần xử lý")
`detectMergeClusters(maturingDeposits, window=7)` groups (goal_id, window), ≥2.
`MaturityActionCard` banner "2 sổ đáo hạn sát nhau… gộp?" → opens sheet on the
**anchor (latest maturity)** with the rest preselected.

### PR 4 — Ví chờ gộp (holding pool) — highest risk, last
Settle an earlier-maturing deposit with "Để dành gộp" → its `withdrawal` row carries
`held_for_merge`, `merge_target_goal_id`, `merge_anchor_inv_id`, `consumed_by_inv_id`.
Overview adds held-unconsumed `amount_vnd` back to the target goal's
progressValue/currentValue (synthesized like recurring fulfillments) — held cash
keeps counting but never appears as a deposit. Merge consumes the holding (fold into
D + set `consumed_by_inv_id = D`, no second withdrawal) atomically. Edges: change
mind → unhold; anchor cancelled → orphan holding. TDD heaviest here: assert no
double-count on **both** dashboard and Plan; new E2E `maturity-combine-holding.spec.ts`
(WSL2).

## Open micro-decisions
- `banks` seed list / logos — using ~20 majors unless a custom list is provided.
- `currency` UI — none in PR0 (default VND); multi-currency entry is a later epic.
- Backfill old deposits' bank — leave NULL, user sets over time (no name-parse guess).
