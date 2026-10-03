-- Several of a month's fund DCAs can be parked in ONE term deposit.
--
-- park_dca_in_deposit (20261002000002) parks one DCA line per deposit, and a
-- unique index on plan_dca_skips.parked_in_tx_id held it there. Real deposits
-- don't follow the funds: the user who DCAs five small funds under Unallocated
-- opens one 5M deposit, and the app would have needed five.
--
-- What this migration changes:
--
--   1. plan_dca_skips.parked_amount_vnd — the share of the deposit a parked
--      line put in: its DCA amount at the time it was parked. With one line the
--      share is the line; with several it is what says how the money divides
--      when the deposit matures. Backfilled for parks made so far (one line,
--      the whole deposit), and required whenever parked_in_tx_id is set.
--   2. The unique index on parked_in_tx_id goes: one deposit, many lines.
--   3. park_dca_lines_in_deposit(...) — parks N lines in one deposit. The lines
--      must share a goal (the deposit is filed under it); each must be a DCA of
--      the plan's owner, not bought and not parked this month. The deposit's
--      target fund is the fund when one line is parked, and none for several —
--      the shares say where the money goes.
--   4. park_dca_in_deposit becomes the one-line call of it, so the code running
--      today keeps working and records its share too.
--
-- Undo is unchanged: deleting the deposit cascades every skip that names it.
--
-- Covered by supabase/tests/park_dca_lines_in_deposit.test.sql and
-- park_dca_in_deposit.test.sql (`npm run test:db`).

-- ── 1) the share a parked line put in ────────────────────────────────────────
alter table public.plan_dca_skips
  add column if not exists parked_amount_vnd bigint
    check (parked_amount_vnd is null or parked_amount_vnd > 0);

comment on column public.plan_dca_skips.parked_amount_vnd is
  'The share of the parked deposit this DCA line put in: its DCA amount when it was parked (park_dca_lines_in_deposit).';

-- Every park so far parked one line, so its share is the whole deposit.
update public.plan_dca_skips s
   set parked_amount_vnd = t.amount_vnd
  from public.investment_transactions t
 where t.transaction_id = s.parked_in_tx_id
   and s.parked_amount_vnd is null;

alter table public.plan_dca_skips
  drop constraint if exists plan_dca_skips_parked_share_shape;
alter table public.plan_dca_skips
  add constraint plan_dca_skips_parked_share_shape
    check ((parked_in_tx_id is null) = (parked_amount_vnd is null));

-- The share is written by the RPC only, like the link it belongs to.
create or replace function public.enforce_parked_dca_written_by_rpc()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.parked_in_tx_id is not null
      or tg_op = 'UPDATE' and (new.parked_in_tx_id is distinct from old.parked_in_tx_id
                               or new.parked_amount_vnd is distinct from old.parked_amount_vnd))
     and auth.uid() is not null
     and coalesce(current_setting('app.park_dca_write', true), '') <> '1' then
    raise exception 'park dca: a DCA is parked through park_dca_lines_in_deposit, not by writing the link'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists plan_dca_skips_parked_rpc_only on public.plan_dca_skips;
create trigger plan_dca_skips_parked_rpc_only
  before insert or update of parked_in_tx_id, parked_amount_vnd on public.plan_dca_skips
  for each row execute function public.enforce_parked_dca_written_by_rpc();

-- ── 2) one deposit, many lines ───────────────────────────────────────────────
drop index if exists public.plan_dca_skips_parked_unique;

create index if not exists plan_dca_skips_parked_in_tx_id
  on public.plan_dca_skips (parked_in_tx_id) where parked_in_tx_id is not null;

-- ── 3) park_dca_lines_in_deposit ─────────────────────────────────────────────
--
-- security invoker: RLS is the ownership boundary for the plan. The funds are
-- checked row-to-row against the plan's owner, which also holds for a
-- service-role caller.
create or replace function public.park_dca_lines_in_deposit(
  p_plan_id uuid,
  p_fund_ids uuid[],
  p_amount_vnd bigint,
  p_interest_rate numeric,
  p_investment_date date,
  p_expiry_date date,
  p_bank_code text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan  public.monthly_plans;
  v_n     int := coalesce(cardinality(p_fund_ids), 0);
  v_owned int;
  v_goals int;
  v_goal  uuid;
  v_fund  public.funds;
  v_dep   uuid;
begin
  if p_amount_vnd is null or p_amount_vnd <= 0 then
    raise exception 'park dca: the amount must be positive' using errcode = 'check_violation';
  end if;
  if p_interest_rate is null or p_interest_rate <= 0 then
    raise exception 'park dca: a term deposit needs a rate' using errcode = 'check_violation';
  end if;
  if p_investment_date is null or p_expiry_date is null or p_expiry_date <= p_investment_date then
    raise exception 'park dca: the deposit must mature after it is opened' using errcode = 'check_violation';
  end if;
  if p_investment_date > public.business_today() then
    raise exception 'park dca: the deposit cannot be opened in the future' using errcode = 'check_violation';
  end if;
  if v_n = 0 then
    raise exception 'park dca: name at least one DCA to park' using errcode = 'check_violation';
  end if;
  if (select count(distinct f) from unnest(p_fund_ids) f) <> v_n then
    raise exception 'park dca: a fund is named more than once' using errcode = 'check_violation';
  end if;

  select * into v_plan from public.monthly_plans where id = p_plan_id for update;
  if not found then
    raise exception 'park dca: the plan was not found' using errcode = 'no_data_found';
  end if;

  select count(*), count(distinct coalesce(dca_goal_id::text, '')), min(dca_goal_id::text)::uuid
    into v_owned, v_goals, v_goal
    from public.funds
   where id = any(p_fund_ids) and user_id = v_plan.user_id;
  if v_owned <> v_n then
    raise exception 'park dca: a fund does not belong to this plan''s owner' using errcode = 'insufficient_privilege';
  end if;
  if v_goals <> 1 then
    raise exception 'park dca: the DCAs parked in one deposit must share a goal' using errcode = 'check_violation';
  end if;

  for v_fund in
    select * from public.funds where id = any(p_fund_ids) order by id
  loop
    if not coalesce(v_fund.is_dca, false) or v_fund.dca_monthly_amount_vnd is null then
      raise exception 'park dca: % has no DCA to park', v_fund.name using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.investment_transactions
                where plan_id = p_plan_id and fund_id = v_fund.id and asset_type = 'fund' and units is not null) then
      raise exception 'park dca: this month''s DCA for % is already bought', v_fund.name using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.plan_dca_skips
                where plan_id = p_plan_id and fund_id = v_fund.id and parked_in_tx_id is not null) then
      raise exception 'park dca: this month''s DCA for % is already parked', v_fund.name using errcode = 'check_violation';
    end if;
  end loop;

  insert into public.investment_transactions (
    user_id, goal_id, plan_id, asset_type, transaction_type, investment_date,
    amount_vnd, interest_rate, expiry_date, bank_code, notes, target_fund_id
  ) values (
    v_plan.user_id, v_goal, p_plan_id, 'bank', 'investment', p_investment_date,
    p_amount_vnd, p_interest_rate, p_expiry_date, p_bank_code, p_notes,
    case when v_n = 1 then p_fund_ids[1] end
  )
  returning transaction_id into v_dep;

  delete from public.investment_transactions
   where plan_id = p_plan_id and fund_id = any(p_fund_ids) and asset_type = 'fund'
     and is_dca_seeded and units is null;
  delete from public.plan_dca_skips where plan_id = p_plan_id and fund_id = any(p_fund_ids);

  perform set_config('app.park_dca_write', '1', true);
  insert into public.plan_dca_skips (plan_id, fund_id, parked_in_tx_id, parked_amount_vnd)
  select p_plan_id, f.id, v_dep, f.dca_monthly_amount_vnd
    from public.funds f
   where f.id = any(p_fund_ids);
  perform set_config('app.park_dca_write', '', true);

  return v_dep;
end;
$$;

revoke all on function public.park_dca_lines_in_deposit(uuid, uuid[], bigint, numeric, date, date, text, text) from public, anon;
grant execute on function public.park_dca_lines_in_deposit(uuid, uuid[], bigint, numeric, date, date, text, text) to authenticated, service_role;

-- ── 4) park_dca_in_deposit: the one-line call ────────────────────────────────
create or replace function public.park_dca_in_deposit(
  p_plan_id uuid,
  p_fund_id uuid,
  p_amount_vnd bigint,
  p_interest_rate numeric,
  p_investment_date date,
  p_expiry_date date,
  p_bank_code text default null,
  p_notes text default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select public.park_dca_lines_in_deposit(
    p_plan_id, array[p_fund_id], p_amount_vnd, p_interest_rate,
    p_investment_date, p_expiry_date, p_bank_code, p_notes
  );
$$;
