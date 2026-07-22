-- Deleting a monthly plan must be atomic (#472): the single DELETE cascades
-- every plan-scoped child, detaches investment transactions (SET NULL), and — if
-- anything in that cascade fails — rolls the whole thing back with nothing lost.
--
-- Runs against the local stack inside a rolled-back transaction. Any failed
-- assertion RAISEs and, under `psql -v ON_ERROR_STOP=1`, exits non-zero.
-- Run via `npm run test:db`.

begin;

do $$
declare
  v_user uuid;
  v_plan uuid;
  v_fund uuid;
  v_exp uuid;
  v_member uuid;
  v_saving uuid;
  v_tx uuid;
  v_children int;
begin
  insert into auth.users (id, email)
    values (gen_random_uuid(), 'plan-delete@test.invalid') returning id into v_user;

  -- Supporting parent rows the children reference.
  insert into public.fixed_expenses (user_id, expense_name, amount_vnd, category)
    values (v_user, 'Rent', 1000000, 'housing') returning expense_id into v_exp;
  insert into public.funds (user_id, name, code, fund_type, nav)
    values (v_user, 'Fund', 'PDLF', 'equity', 20000) returning id into v_fund;
  insert into public.recurring_savings (user_id, name, amount_vnd)
    values (v_user, 'Save', 1000000) returning saving_id into v_saving;
  insert into public.insurance_members (user_id, member_name, relationship, annual_payment_vnd)
    values (v_user, 'Me', 'self', 6000000) returning member_id into v_member;

  -- ---- Scenario 1: one DELETE cascades every child; the transaction detaches --
  insert into public.monthly_plans (user_id, month, year, salary_vnd)
    values (v_user, 9, 2099, 50000000) returning id into v_plan;

  insert into public.fixed_expense_overrides (plan_id, fixed_expense_id, monthly_amount_override_vnd)
    values (v_plan, v_exp, 900000);
  insert into public.plan_other_expenses (plan_id, description, amount_vnd)
    values (v_plan, 'One-off', 500000);
  insert into public.plan_dca_skips (plan_id, fund_id) values (v_plan, v_fund);
  insert into public.recurring_saving_overrides (plan_id, recurring_saving_id, monthly_amount_override_vnd)
    values (v_plan, v_saving, 800000);
  insert into public.plan_excluded_insurance_members (plan_id, member_id) values (v_plan, v_member);
  insert into public.plan_insurance_member_overrides (plan_id, member_id, monthly_amount_override_vnd)
    values (v_plan, v_member, 400000);
  insert into public.investment_transactions (user_id, asset_type, transaction_type, investment_date, amount_vnd, plan_id)
    values (v_user, 'fund', 'investment', '2099-09-01', 2000000, v_plan) returning transaction_id into v_tx;

  select count(*) into v_children from (
    select plan_id from public.fixed_expense_overrides where plan_id = v_plan
    union all select plan_id from public.plan_other_expenses where plan_id = v_plan
    union all select plan_id from public.plan_dca_skips where plan_id = v_plan
    union all select plan_id from public.recurring_saving_overrides where plan_id = v_plan
    union all select plan_id from public.plan_excluded_insurance_members where plan_id = v_plan
    union all select plan_id from public.plan_insurance_member_overrides where plan_id = v_plan
  ) c;
  if v_children <> 6 then raise exception 'setup: expected 6 child rows, got %', v_children; end if;

  delete from public.monthly_plans where id = v_plan;

  if exists (select 1 from public.monthly_plans where id = v_plan) then
    raise exception 'plan was not deleted';
  end if;

  select count(*) into v_children from (
    select plan_id from public.fixed_expense_overrides where plan_id = v_plan
    union all select plan_id from public.plan_other_expenses where plan_id = v_plan
    union all select plan_id from public.plan_dca_skips where plan_id = v_plan
    union all select plan_id from public.recurring_saving_overrides where plan_id = v_plan
    union all select plan_id from public.plan_excluded_insurance_members where plan_id = v_plan
    union all select plan_id from public.plan_insurance_member_overrides where plan_id = v_plan
  ) c;
  if v_children <> 0 then raise exception 'children not cascaded: % remain', v_children; end if;

  if not exists (select 1 from public.investment_transactions where transaction_id = v_tx and plan_id is null) then
    raise exception 'investment_transaction should survive the plan with plan_id NULL';
  end if;

  raise notice 'scenario 1 (cascade + set null): OK';

  -- ---- Scenario 2: a failure anywhere in the cascade rolls everything back ----
  insert into public.monthly_plans (user_id, month, year, salary_vnd)
    values (v_user, 10, 2099, 50000000) returning id into v_plan;
  insert into public.fixed_expense_overrides (plan_id, fixed_expense_id, monthly_amount_override_vnd)
    values (v_plan, v_exp, 900000);
  insert into public.plan_other_expenses (plan_id, description, amount_vnd)
    values (v_plan, 'One-off', 500000);

  -- Force the cascade to fail: a trigger that raises when a plan_other_expenses
  -- row is deleted. It fires inside the plan DELETE's cascade, so the whole
  -- statement — plan row and every other cascaded child — must roll back.
  create function pg_temp.block_del() returns trigger language plpgsql as $t$
    begin raise exception 'forced cascade failure'; end
  $t$;
  create trigger tmp_block before delete on public.plan_other_expenses
    for each row execute function pg_temp.block_del();

  begin
    delete from public.monthly_plans where id = v_plan;
  exception when others then
    null; -- expected: the forced failure aborts the statement
  end;

  drop trigger tmp_block on public.plan_other_expenses;

  -- Nothing may have been lost: plan and both children are still present.
  if not exists (select 1 from public.monthly_plans where id = v_plan) then
    raise exception 'rollback failed: plan was deleted';
  end if;
  if not exists (select 1 from public.plan_other_expenses where plan_id = v_plan) then
    raise exception 'rollback failed: plan_other_expenses lost';
  end if;
  if not exists (select 1 from public.fixed_expense_overrides where plan_id = v_plan) then
    raise exception 'rollback failed: fixed_expense_overrides lost';
  end if;

  raise notice 'scenario 2 (forced-failure rollback): OK';
end $$;

rollback;
