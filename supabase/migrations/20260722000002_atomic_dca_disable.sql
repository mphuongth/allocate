-- Make disabling DCA atomic and serialize it with plan auto-seeding (#473).
--
-- Updating funds first and deleting pending allocations in a second PostgREST
-- request leaves a partial state when the delete fails. It also races with
-- seed_and_sync_plan_dca: a seed started before the disable can commit a pending
-- row after the cleanup has already taken its snapshot. This migration:
--   1. moves the fund update + cleanup into one transaction;
--   2. makes plan seeding take a SHARE row lock on eligible funds, which
--      conflicts with the disable UPDATE and gives the two paths a stable order;
--   3. makes every plan seed self-heal stale pending rows for funds that are no
--      longer eligible or are skipped in that plan.

create or replace function public.disable_fund_dca(
  p_fund_id uuid,
  p_name text,
  p_code text,
  p_fund_type text,
  p_nav numeric,
  p_nav_source_url text
)
returns public.funds
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_fund public.funds;
begin
  -- UPDATE takes a row lock that conflicts with seed_and_sync_plan_dca's
  -- FOR SHARE lock. Whichever path starts first completes before the other can
  -- decide whether this fund is eligible for seeding.
  update public.funds
     set name = p_name,
         code = p_code,
         fund_type = p_fund_type,
         nav = p_nav,
         nav_source_url = p_nav_source_url,
         is_dca = false,
         dca_monthly_amount_vnd = null,
         dca_goal_id = null
   where id = p_fund_id
     and user_id = auth.uid()
  returning * into v_fund;

  if not found then
    raise no_data_found using message = 'Fund not found';
  end if;

  delete from public.investment_transactions
   where user_id = v_fund.user_id
     and fund_id = v_fund.id
     and asset_type = 'fund'
     and is_dca_seeded
     and units is null;

  return v_fund;
end;
$$;

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

  if v_user_id is null then
    return 0;
  end if;

  v_first_of_month := make_date(v_year, v_month, 1);

  -- Coordinate with disable_fund_dca. If seeding locks an active fund first,
  -- disable waits and subsequently removes the new pending row. If disable owns
  -- the row first, this statement waits, rechecks the updated row, and does not
  -- lock/seed it as active.
  perform f.id
    from public.funds f
   where f.user_id = v_user_id
     and f.is_dca
   order by f.id
   for share;

  -- Reconcile removals as well as insert/update. This repairs any stale state
  -- produced before this migration and is defense in depth for future callers:
  -- only pending seeded rows are retired; recorded purchases remain history.
  delete from public.investment_transactions it
   where it.user_id = v_user_id
     and it.plan_id = p_plan_id
     and it.asset_type = 'fund'
     and it.is_dca_seeded
     and it.units is null
     and (
       not exists (
         select 1
           from public.funds f
          where f.id = it.fund_id
            and f.user_id = v_user_id
            and f.is_dca
            and f.dca_monthly_amount_vnd is not null
       )
       or exists (
         select 1
           from public.plan_dca_skips s
          where s.plan_id = p_plan_id
            and s.fund_id = it.fund_id
       )
     );

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

  with updated as (
    update public.investment_transactions it
       set amount_vnd = f.dca_monthly_amount_vnd,
           goal_id = f.dca_goal_id,
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
