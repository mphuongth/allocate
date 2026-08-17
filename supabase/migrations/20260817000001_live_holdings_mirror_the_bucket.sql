-- savings_goal_live_holdings measures a bucket the way the invariant does (#668).
--
-- It carries its own copy of check_withdrawal_balance's parent-backed-claim
-- derivation, and says why in its own comment: "Derivation copied from
-- 20260803000005 so the two cannot disagree." #668 put `p.user_id = wd.user_id`
-- into that function — a fund bucket counts only its own owner's purchases — and
-- left the copy behind. This is the copy catching up.
--
-- The direction of the disagreement is the bad one. This function subtracts MORE
-- than the invariant now does, so the sale it proposes is smaller than the balance
-- allows: the invariant accepts it, and the goal is archived without being fully
-- liquidated. Probed against the local stack, with the ownership trigger disabled
-- to plant the legacy rows:
--
--   A's goal holds one 100-unit purchase. A legacy purchase owned by B carries
--   that goal and fund; A has a 10-unit claim parented to it.
--
--     savings_goal_live_holdings → 90 units / 90,000,000
--     finish_savings_goal        → {"holdings": 1, "realized": 90000000,
--                                   "completion_percentage": 100}
--     units left in the archived goal → 10
--
-- A live holding inside a completed goal. The finish is advertised as
-- all-or-nothing and the plan check compares against this same function, so the
-- residue is self-consistent and invisible: no screen shows it, and the goal reads
-- 100%.
--
-- Reachable only through legacy data — enforce_fk_ownership (20260722000004)
-- refuses a cross-owner parent at write time, and withdrawal_ledger_audit names
-- what is already in the ledger (#667). Everything else below is verbatim from
-- 20260813000002.

create or replace function public.savings_goal_live_holdings(p_goal_id uuid)
returns table (
  key text, kind text, fund_id uuid, tx_id uuid, asset_type text,
  principal bigint, units numeric, name text
)
language sql
security invoker
stable
set search_path = ''
as $$
    with parent_wd as (
      select w.parent_transaction_id as pid,
             sum(coalesce(w.principal_withdrawn, 0)) as principal,
             sum(coalesce(w.units_withdrawn, 0)) as units
        from public.investment_transactions w
       where w.user_id = (select g.user_id from public.savings_goals g where g.goal_id = p_goal_id)
         and w.transaction_type = 'withdrawal'
         and w.parent_transaction_id is not null
         -- A row keyed by a fund draws on that bucket, not on its parent — the
         -- same precedence check_withdrawal_balance applies.
         and not coalesce(w.asset_type = 'fund' and w.fund_id is not null, false)
       group by 1
    ),
    fund_wd as (
      select w.fund_id,
             sum(coalesce(w.principal_withdrawn, 0)) as principal,
             sum(coalesce(w.units_withdrawn, 0)) as units
        from public.investment_transactions w
       where w.user_id = (select g.user_id from public.savings_goals g where g.goal_id = p_goal_id)
         and w.transaction_type = 'withdrawal'
         and w.asset_type = 'fund'
         and w.fund_id is not null
         and w.goal_id is not distinct from p_goal_id
       group by 1
    ),
    -- The bucket's OTHER kind of claim (#606). A withdrawal PARENTED to one of
    -- its purchases and not itself fund-keyed draws on the bucket too, at its
    -- recorded units or the capped pro-rata share of the purchase it names.
    -- Such rows can no longer be written, but the ones already in the ledger are
    -- still claims and check_withdrawal_balance measures every new sale against
    -- them — so a goal holding one could not be finished at all: this function
    -- computed the gross bucket and the table refused the oversized sale.
    -- Derivation copied from 20260803000005 so the two cannot disagree.
    fund_parent_wd as (
      select p.fund_id,
             sum(case when coalesce(w.units_withdrawn, 0) > 0 then w.units_withdrawn
                      else least(p.units, p.units * coalesce(w.principal_withdrawn, 0) / p.amount_vnd)
                 end) as units,
             sum(coalesce(w.principal_withdrawn, 0)) as principal
        from public.investment_transactions w
        join public.investment_transactions p
          on p.transaction_id = w.parent_transaction_id
       where w.user_id = (select g.user_id from public.savings_goals g where g.goal_id = p_goal_id)
         and w.transaction_type = 'withdrawal'
         and (w.asset_type is distinct from 'fund' or w.fund_id is null)
         and p.transaction_type = 'investment'
         and p.asset_type = 'fund'
         -- The PURCHASE's owner, matching check_withdrawal_balance since #668. Its
         -- basis sum counts only the goal owner's own purchases, so a claim on
         -- someone else's is charged against units this bucket was never counted to
         -- hold — and subtracting it here understates what the finish must sell.
         and p.user_id = (select g.user_id from public.savings_goals g where g.goal_id = p_goal_id)
         and p.goal_id is not distinct from p_goal_id
         -- A purchase with no units is no bucket: its withdrawal sits on the
         -- parent axis and is measured there instead.
         and coalesce(p.units, 0) > 0
         and coalesce(p.amount_vnd, 0) > 0
       group by p.fund_id
    ),
    live as (
      select t.*,
             t.amount_vnd - coalesce(pw.principal, 0) as eff_principal,
             coalesce(t.units, 0) - coalesce(pw.units, 0) as eff_units
        from public.investment_transactions t
        left join parent_wd pw on pw.pid = t.transaction_id
       where t.user_id = (select g.user_id from public.savings_goals g where g.goal_id = p_goal_id)
         and t.goal_id = p_goal_id
         and t.transaction_type = 'investment'
         and t.renewed_from_transaction_id is null
         and not coalesce(t.held_for_merge, false)
    )
    select 'fund:' || l.fund_id as key, 'fund'::text as kind, l.fund_id,
           null::uuid as tx_id, 'fund'::text as asset_type,
           (sum(l.amount_vnd) - coalesce(max(fw.principal), 0) - coalesce(max(fpw.principal), 0))::bigint as principal,
           (sum(l.units) - coalesce(max(fw.units), 0) - coalesce(max(fpw.units), 0))::numeric as units
           , max(f.name) as name
      from live l
      left join public.funds f on f.id = l.fund_id
      left join fund_wd fw on fw.fund_id = l.fund_id
      left join fund_parent_wd fpw on fpw.fund_id = l.fund_id
     where l.fund_id is not null and l.asset_type = 'fund' and l.units is not null
     group by l.fund_id
    having sum(l.units) - coalesce(max(fw.units), 0) - coalesce(max(fpw.units), 0) > 0
    union all
    select 'book:' || l.deposit_group_id, 'book', null, l.deposit_group_id, 'bank',
           sum(l.eff_principal)::bigint, null::numeric,
           max(case when l.transaction_id = l.deposit_group_id then l.notes end)
      from live l
     where l.fund_id is null and l.deposit_group_id is not null
       and l.eff_principal > 0
     group by l.deposit_group_id
    union all
    select 'tx:' || l.transaction_id, 'single', null, l.transaction_id, l.asset_type,
           l.eff_principal::bigint,
           case when l.asset_type = 'gold' then l.eff_units::numeric else null end,
           l.notes
      from live l
     where l.fund_id is null and l.deposit_group_id is null
       and (case when l.asset_type = 'gold' then l.eff_units > 0 else l.eff_principal > 0 end)
$$;

comment on function public.savings_goal_live_holdings(uuid) is
  'The holdings a finish would liquidate, by the same balance keys the ledger uses (#650). One enumeration for the sheet and the RPC.';
