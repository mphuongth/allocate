-- A month's fund DCA can be parked in a term deposit instead.
--
-- When deposit rates are high, the user puts this month's DCA for a fund into a
-- new term deposit, to move into the fund at maturity (move_deposit_to_fund).
-- On the plan that is one decision: the deposit exists (this month's plan, the
-- DCA's goal, its target fund the DCA's fund), the pending DCA seed goes, and a
-- skip row stops the next load re-seeding it — naming the deposit, so the line
-- can say where the money went. park_dca_in_deposit writes all of it at once.
--
-- Undo is deleting the deposit: the skip cascades and the DCA is seeded again.
-- Deleting the skip alone is refused while the deposit exists — the DCA would
-- come back beside money already counted for the month.

alter table public.plan_dca_skips
  add column if not exists parked_in_tx_id uuid
    references public.investment_transactions(transaction_id) on delete cascade;

create unique index if not exists plan_dca_skips_parked_unique
  on public.plan_dca_skips (parked_in_tx_id) where parked_in_tx_id is not null;

comment on column public.plan_dca_skips.parked_in_tx_id is
  'The term deposit this month''s DCA was parked in instead of buying the fund (park_dca_in_deposit).';

drop trigger if exists plan_dca_skips_parked_fk_ownership on public.plan_dca_skips;
create trigger plan_dca_skips_parked_fk_ownership
  before insert or update of parked_in_tx_id, plan_id on public.plan_dca_skips
  for each row execute function public.enforce_plan_scoped_fk_ownership(
    'parked_in_tx_id', 'investment_transactions', 'transaction_id');

-- Written by park_dca_in_deposit only (same mechanism as 20261001000001).
create or replace function public.enforce_parked_dca_written_by_rpc()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.parked_in_tx_id is not null
      or tg_op = 'UPDATE' and new.parked_in_tx_id is distinct from old.parked_in_tx_id)
     and auth.uid() is not null
     and coalesce(current_setting('app.park_dca_write', true), '') <> '1' then
    raise exception 'park dca: a DCA is parked through park_dca_in_deposit, not by writing the link'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists plan_dca_skips_parked_rpc_only on public.plan_dca_skips;
create trigger plan_dca_skips_parked_rpc_only
  before insert or update of parked_in_tx_id on public.plan_dca_skips
  for each row execute function public.enforce_parked_dca_written_by_rpc();

-- During the cascade from the deposit the deposit is already gone, so the
-- lookup finds nothing and the delete goes through.
create or replace function public.refuse_unparking_dca()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.investment_transactions where transaction_id = old.parked_in_tx_id) then
    raise exception 'park dca: this DCA was parked in a deposit — delete the deposit to undo it'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists plan_dca_skips_parked_not_deletable on public.plan_dca_skips;
create trigger plan_dca_skips_parked_not_deletable
  before delete on public.plan_dca_skips
  for each row when (old.parked_in_tx_id is not null)
  execute function public.refuse_unparking_dca();

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
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan public.monthly_plans;
  v_fund public.funds;
  v_dep  uuid;
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

  -- RLS is the ownership boundary: someone else's plan is not visible.
  select * into v_plan from public.monthly_plans where id = p_plan_id for update;
  if not found then
    raise exception 'park dca: the plan was not found' using errcode = 'no_data_found';
  end if;

  select * into v_fund from public.funds where id = p_fund_id and user_id = v_plan.user_id;
  if not found then
    raise exception 'park dca: the fund does not belong to this plan''s owner' using errcode = 'insufficient_privilege';
  end if;
  if not coalesce(v_fund.is_dca, false) or v_fund.dca_monthly_amount_vnd is null then
    raise exception 'park dca: this fund has no DCA to park' using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.investment_transactions
              where plan_id = p_plan_id and fund_id = p_fund_id and asset_type = 'fund' and units is not null) then
    raise exception 'park dca: this month''s DCA for the fund is already bought' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.plan_dca_skips
              where plan_id = p_plan_id and fund_id = p_fund_id and parked_in_tx_id is not null) then
    raise exception 'park dca: this month''s DCA for the fund is already parked' using errcode = 'check_violation';
  end if;

  insert into public.investment_transactions (
    user_id, goal_id, plan_id, asset_type, transaction_type, investment_date,
    amount_vnd, interest_rate, expiry_date, bank_code, notes, target_fund_id
  ) values (
    v_plan.user_id, v_fund.dca_goal_id, p_plan_id, 'bank', 'investment', p_investment_date,
    p_amount_vnd, p_interest_rate, p_expiry_date, p_bank_code, p_notes, p_fund_id
  )
  returning transaction_id into v_dep;

  delete from public.investment_transactions
   where plan_id = p_plan_id and fund_id = p_fund_id and asset_type = 'fund'
     and is_dca_seeded and units is null;

  delete from public.plan_dca_skips where plan_id = p_plan_id and fund_id = p_fund_id;
  perform set_config('app.park_dca_write', '1', true);
  insert into public.plan_dca_skips (plan_id, fund_id, parked_in_tx_id) values (p_plan_id, p_fund_id, v_dep);
  perform set_config('app.park_dca_write', '', true);

  return v_dep;
end;
$$;

revoke all on function public.park_dca_in_deposit(uuid, uuid, bigint, numeric, date, date, text, text) from public, anon;
grant execute on function public.park_dca_in_deposit(uuid, uuid, bigint, numeric, date, date, text, text) to authenticated, service_role;
