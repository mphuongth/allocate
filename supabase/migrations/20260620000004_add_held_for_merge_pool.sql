-- "Ví chờ gộp" (merge holding pool) — PR4 of "Gộp nhiều nguồn".
--
-- An earlier-maturing deposit can mature days before the deposit it should merge
-- into (the anchor D). Forcing the user to either leave it idle or settle it to
-- loose cash (which drops the goal) is the gap this closes. They can now settle
-- it with "Để dành gộp" (hold for merge): the deposit is closed by a normal
-- withdrawal row, but that row is FLAGGED as held — its cash stays earmarked to
-- the goal and the intended anchor, and the dashboard/Plan synthesize it back so
-- the goal value never dips. When the anchor matures, the merge consumes the
-- holding (folds the held cash into D and stamps consumed_by_inv_id) instead of
-- opening a second withdrawal.
--
-- Decision (owner): the pool is a FLAG ON THE SETTLEMENT (withdrawal) row, NOT a
-- zero-interest deposit row — held cash has left the bank product, so it must not
-- leak into NAV / maturity sweeps / any asset_type='bank' aggregation. These four
-- columns live only on withdrawal rows (held_for_merge=true); they are NULL/false
-- on every deposit and on plain (non-held) withdrawals.
alter table public.investment_transactions
  -- Marks a settlement (withdrawal) whose cash is parked for a future merge.
  add column if not exists held_for_merge boolean not null default false,
  -- The goal the held cash stays earmarked to (so the synthesizer knows where to
  -- add it back). Mirrors the source deposit's goal_id at hold time. Deliberately
  -- NOT a FK to savings_goals: investment_transactions already has goal_id ->
  -- savings_goals, and a SECOND FK to the same table makes every PostgREST
  -- `savings_goals(goal_name)` embed on this table ambiguous ("more than one
  -- relationship found" → 500). The row's own goal_id FK already enforces goal
  -- existence + delete cascade, so this app-managed mirror needs no constraint.
  add column if not exists merge_target_goal_id uuid,
  -- The deposit the user intends to fold this into (the anchor). Informational /
  -- for surfacing "đang chờ gộp vào …"; not a hard constraint at merge time.
  add column if not exists merge_anchor_inv_id uuid references public.investment_transactions(transaction_id),
  -- Set to the renewed anchor's id once the merge folds this holding in. NULL =
  -- still in the pool (synthesized back to the goal); non-NULL = consumed (the
  -- cash now lives in that deposit's principal, so stop synthesizing it).
  add column if not exists consumed_by_inv_id uuid references public.investment_transactions(transaction_id);

-- The pool query is "held, unconsumed" — a partial index keeps it cheap and makes
-- the intent explicit (the overwhelming majority of withdrawals are not held).
create index if not exists investment_transactions_held_for_merge_idx
  on public.investment_transactions (merge_target_goal_id)
  where held_for_merge and consumed_by_inv_id is null;

-- active_investment_transactions is a SELECT * view whose column list froze at
-- creation (see 20260620000001), so it does NOT expose columns added afterwards.
-- The dashboard overview reads the held-pool columns FROM THIS VIEW to synthesize
-- the held cash, so it must be re-expanded or the select errors and the overview
-- 500s. CREATE OR REPLACE re-expands `*` to the current columns (the four new
-- ones append at the end, which replace allows). security_invoker stays on
-- (required — see 20260613000003).
create or replace view public.active_investment_transactions
  with (security_invoker = true) as
  select * from public.investment_transactions
  where renewed_from_transaction_id is null;

grant select on public.active_investment_transactions to authenticated;
