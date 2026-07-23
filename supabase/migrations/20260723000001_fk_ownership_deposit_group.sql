-- Extend the FK-ownership backstop to deposit_group_id (#474 follow-up).
--
-- deposit_group_id is the anchor transaction id that groups an accumulating
-- book's tranches, and the UI groups books solely by that value. It was the one
-- transaction-to-transaction reference the ownership trigger didn't guard, so a
-- service-role write (or a future endpoint that sets it directly) could still
-- point a row at another user's transaction as its book group.
--
-- A brand-new book anchor self-groups: deposit_group_id = its own
-- transaction_id, which doesn't exist yet during BEFORE INSERT — so allow the
-- self-reference explicitly and only ownership-check a group that points at a
-- different (must be same-owner) transaction.

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
  if new.plan_id is not null and not exists (
    select 1 from public.monthly_plans where id = new.plan_id and user_id = new.user_id
  ) then
    raise exception 'plan_id % does not belong to the transaction owner', new.plan_id
      using errcode = 'check_violation';
  end if;
  -- goal_id and merge_target_goal_id are both savings-goal references (the latter
  -- an app-managed one, not a physical FK) that must stay within one user.
  foreach v_ref in array array[new.goal_id, new.merge_target_goal_id] loop
    if v_ref is not null and not exists (
      select 1 from public.savings_goals where goal_id = v_ref and user_id = new.user_id
    ) then
      raise exception 'goal reference % does not belong to the transaction owner', v_ref
        using errcode = 'check_violation';
    end if;
  end loop;
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
  -- deposit_group_id — same rule. The self-grouping anchor
  -- (deposit_group_id = its own transaction_id) references a row that doesn't
  -- exist yet, so bypass the lookup ONLY on INSERT. On UPDATE the anchor row
  -- already exists, so it's checked normally against NEW.user_id — which rejects
  -- moving an owner-changed anchor away from its still-original-owner tranches.
  if new.deposit_group_id is not null
     and not (tg_op = 'INSERT' and new.deposit_group_id = new.transaction_id)
     and not exists (
       select 1 from public.investment_transactions where transaction_id = new.deposit_group_id and user_id = new.user_id
     ) then
    raise exception 'deposit_group_id % does not belong to the transaction owner', new.deposit_group_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists investment_transactions_fk_ownership on public.investment_transactions;
create trigger investment_transactions_fk_ownership
  before insert or update of
    fund_id, goal_id, merge_target_goal_id, plan_id, user_id,
    parent_transaction_id, renewed_from_transaction_id, merge_anchor_inv_id, consumed_by_inv_id, deposit_group_id
  on public.investment_transactions
  for each row execute function public.enforce_investment_tx_fk_ownership();
