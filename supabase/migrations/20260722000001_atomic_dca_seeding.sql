-- Make DCA auto-seeding atomic and idempotent (#466).
--
-- `GET /api/v1/monthly-plans?full=true` used to read the existing DCA rows and
-- INSERT the missing ones in separate steps, with nothing stopping two
-- concurrent loads from both seeing a row missing and both inserting it — there
-- was no uniqueness constraint on a pending DCA row. That produced duplicate
-- planned allocations and inflated monthly totals, and any swallowed query error
-- (treated as "no rows") could trigger a bogus re-seed.
--
-- This migration adds the missing constraint and folds the whole seed-and-sync
-- into one transactional RPC, so the read-then-write race and the half-seeded
-- states are gone.

-- ---------------------------------------------------------------------------
-- 1) Heal any pre-existing duplicates so the unique index can be created.
--    A fund can legitimately have several *manual* transactions in one plan, so
--    we only touch auto-seeded rows (is_dca_seeded). Among duplicates for a
--    (plan_id, fund_id) we keep the row a user has actually recorded units into
--    if there is one, otherwise the earliest — the extras are the corruption.
delete from investment_transactions it
using (
  select transaction_id,
         row_number() over (
           partition by plan_id, fund_id
           order by (units is not null) desc, created_at asc, transaction_id asc
         ) as rn
    from investment_transactions
   where is_dca_seeded
     and asset_type = 'fund'
     and plan_id is not null
) dup
where it.transaction_id = dup.transaction_id
  and dup.rn > 1;

-- ---------------------------------------------------------------------------
-- 2) At most one auto-seeded DCA row per (plan, fund). Partial so it never
--    constrains manually-added fund transactions, and it's the conflict target
--    the RPC's insert relies on to collapse a concurrent double-seed.
create unique index if not exists investment_transactions_dca_seeded_uniq
  on investment_transactions (plan_id, fund_id)
  where is_dca_seeded and asset_type = 'fund';

-- ---------------------------------------------------------------------------
-- 3) Atomic seed + sync. Runs as the caller (security invoker) so RLS scopes it
--    to their own rows; the plan's owner is resolved from the plan row, so a
--    caller who doesn't own the plan simply sees nothing and the function
--    no-ops. Everything below runs in one transaction: a failing statement
--    aborts the whole thing instead of leaving a plan half-seeded, and the
--    ON CONFLICT DO NOTHING insert makes two concurrent callers converge on a
--    single row. Returns the number of rows inserted or updated.
create or replace function public.seed_and_sync_plan_dca(p_plan_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_year int;
  v_month int;
  v_first_of_month date;
  v_inserted int := 0;
  v_updated int := 0;
begin
  select user_id, year, month
    into v_user_id, v_year, v_month
    from public.monthly_plans
   where id = p_plan_id;

  -- No such plan for this caller (or it doesn't exist): nothing to seed.
  if v_user_id is null then
    return 0;
  end if;

  v_first_of_month := make_date(v_year, v_month, 1);

  -- Insert a pending row for every eligible DCA fund that has no fund
  -- transaction yet in this plan. The NOT EXISTS is the fast path; the partial
  -- unique index + ON CONFLICT DO NOTHING is the race backstop when two callers
  -- clear that check at the same instant.
  with inserted as (
    insert into public.investment_transactions (
      user_id, plan_id, fund_id, goal_id, asset_type, amount_vnd,
      units, unit_price, investment_date, is_dca_seeded
    )
    select
      v_user_id, p_plan_id, f.id, f.dca_goal_id, 'fund', f.dca_monthly_amount_vnd,
      null, null, v_first_of_month, true
    from public.funds f
    where f.user_id = v_user_id
      and f.is_dca
      and f.dca_monthly_amount_vnd is not null
      and not exists (
        select 1 from public.plan_dca_skips s
         where s.plan_id = p_plan_id and s.fund_id = f.id
      )
      and not exists (
        select 1 from public.investment_transactions it
         where it.plan_id = p_plan_id
           and it.fund_id = f.id
           and it.asset_type = 'fund'
      )
    on conflict (plan_id, fund_id) where is_dca_seeded and asset_type = 'fund'
    do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  -- Keep still-pending seeded rows aligned with the fund's current DCA amount
  -- and goal (both change when DCA is re-toggled / re-pointed). Rows the user
  -- has recorded units into (units is not null) are left untouched.
  with updated as (
    update public.investment_transactions it
       set amount_vnd = f.dca_monthly_amount_vnd,
           goal_id    = f.dca_goal_id,
           updated_at = now()
      from public.funds f
     where it.fund_id = f.id
       and it.plan_id = p_plan_id
       and it.asset_type = 'fund'
       and it.is_dca_seeded
       and it.units is null
       and f.user_id = v_user_id
       and f.is_dca
       and f.dca_monthly_amount_vnd is not null
       and not exists (
         select 1 from public.plan_dca_skips s
          where s.plan_id = p_plan_id and s.fund_id = f.id
       )
       and (it.amount_vnd is distinct from f.dca_monthly_amount_vnd
            or it.goal_id is distinct from f.dca_goal_id)
    returning 1
  )
  select count(*) into v_updated from updated;

  return v_inserted + v_updated;
end;
$$;
