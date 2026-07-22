-- Enforce same-user ownership of foreign-key targets at the database level (#474).
--
-- RLS only guarantees the *row's own* user_id matches auth.uid(); a Postgres FK
-- only guarantees the referenced row exists. Neither stops a writer from linking
-- a fund_id / goal_id / dca_goal_id owned by a *different* user. The API now
-- checks ownership before writing, but these BEFORE triggers are defense in
-- depth: any path (service role, a future endpoint that forgets the check) is
-- still forced to keep the reference within one user.
--
-- SECURITY DEFINER + an explicit `user_id = new.user_id` filter so the check is
-- authoritative regardless of the caller's RLS visibility. A composite FK
-- (id, user_id) would be the "purer" guard but is incompatible with the existing
-- ON DELETE SET NULL on these columns (it would try to NULL the NOT NULL
-- user_id), so triggers are the feasible mechanism.

create or replace function public.enforce_investment_tx_fk_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref uuid;
begin
  if new.fund_id is not null and not exists (
    select 1 from public.funds where id = new.fund_id and user_id = new.user_id
  ) then
    raise exception 'fund_id % does not belong to the transaction owner', new.fund_id
      using errcode = 'check_violation';
  end if;
  if new.goal_id is not null and not exists (
    select 1 from public.savings_goals where goal_id = new.goal_id and user_id = new.user_id
  ) then
    raise exception 'goal_id % does not belong to the transaction owner', new.goal_id
      using errcode = 'check_violation';
  end if;
  -- Transaction-to-transaction references must stay within one user too, or a
  -- caller who knows a foreign transaction UUID could point their own row at it.
  foreach v_ref in array array[
    new.parent_transaction_id,
    new.renewed_from_transaction_id,
    new.merge_anchor_inv_id,
    new.consumed_by_inv_id
  ] loop
    if v_ref is not null and not exists (
      select 1 from public.investment_transactions where transaction_id = v_ref and user_id = new.user_id
    ) then
      raise exception 'referenced transaction % does not belong to the transaction owner', v_ref
        using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists investment_transactions_fk_ownership on public.investment_transactions;
create trigger investment_transactions_fk_ownership
  before insert or update of
    fund_id, goal_id, user_id,
    parent_transaction_id, renewed_from_transaction_id, merge_anchor_inv_id, consumed_by_inv_id
  on public.investment_transactions
  for each row execute function public.enforce_investment_tx_fk_ownership();

create or replace function public.enforce_funds_fk_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.dca_goal_id is not null and not exists (
    select 1 from public.savings_goals where goal_id = new.dca_goal_id and user_id = new.user_id
  ) then
    raise exception 'dca_goal_id % does not belong to the fund owner', new.dca_goal_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists funds_fk_ownership on public.funds;
create trigger funds_fk_ownership
  before insert or update of dca_goal_id, user_id on public.funds
  for each row execute function public.enforce_funds_fk_ownership();
