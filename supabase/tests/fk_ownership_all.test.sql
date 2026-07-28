-- Same-user ownership for every remaining user-owned FK (#525).
--
-- #474 put ownership triggers on investment_transactions and funds. Nine other
-- references were left validating only the row's own scope: RLS checks the row's
-- user_id (or its plan's), and a Postgres FK only checks that the target exists.
-- Neither stops a writer pointing at a row that belongs to someone else, so a
-- caller who knows a foreign UUID could attach it — probing existence, and
-- letting one user's delete cascade into another's data.
--
-- The nine come in two shapes, and the trigger has to handle both:
--
--   plan-scoped (no user_id of their own — owner resolved via monthly_plans):
--     plan_insurance_member_overrides.member_id     -> insurance_members
--     plan_excluded_insurance_members.member_id     -> insurance_members
--     fixed_expense_overrides.fixed_expense_id      -> fixed_expenses
--     recurring_saving_overrides.recurring_saving_id-> recurring_savings
--     plan_dca_skips.fund_id                        -> funds
--
--   user-scoped (user_id on the row itself):
--     insurance_savings.insurance_member_id         -> insurance_members
--     recurring_savings.goal_id                     -> savings_goals
--     recurring_savings.linked_deposit_tx_id        -> investment_transactions
--     recurring_saving_fulfillments.recurring_saving_id -> recurring_savings
--
-- Each is checked twice: the same-user write must succeed (existing rows keep
-- working) and the cross-user write must be rejected. The rejection is asserted
-- on SQLSTATE 23514 specifically, so a row failing for some unrelated reason
-- can't be mistaken for the guard doing its job.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  ua uuid; ub uuid;             -- two users
  plan_a uuid; plan_b uuid;
  mem_a  uuid; mem_b  uuid;     -- insurance_members
  exp_a  uuid; exp_b  uuid;     -- fixed_expenses
  fund_a uuid; fund_b uuid;
  goal_a uuid; goal_b uuid;
  rec_a  uuid; rec_b  uuid;     -- recurring_savings
  tx_a   uuid; tx_b   uuid;     -- investment_transactions
  ok     boolean;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'fkall-a@test.invalid') returning id into ua;
  insert into auth.users (id, email) values (gen_random_uuid(), 'fkall-b@test.invalid') returning id into ub;

  insert into public.monthly_plans (user_id, month, year, salary_vnd) values (ua, 1, 2026, 1000) returning id into plan_a;
  insert into public.monthly_plans (user_id, month, year, salary_vnd) values (ub, 2, 2026, 1000) returning id into plan_b;

  insert into public.insurance_members (user_id, member_name, relationship, annual_payment_vnd) values (ua, 'A', 'self', 120) returning member_id into mem_a;
  insert into public.insurance_members (user_id, member_name, relationship, annual_payment_vnd) values (ub, 'B', 'self', 120) returning member_id into mem_b;

  insert into public.fixed_expenses (user_id, expense_name, amount_vnd, category) values (ua, 'A', 10, 'x') returning expense_id into exp_a;
  insert into public.fixed_expenses (user_id, expense_name, amount_vnd, category) values (ub, 'B', 10, 'x') returning expense_id into exp_b;

  insert into public.funds (user_id, name, code, fund_type, nav) values (ua, 'A', 'AAA', 'equity', 1) returning id into fund_a;
  insert into public.funds (user_id, name, code, fund_type, nav) values (ub, 'B', 'BBB', 'equity', 1) returning id into fund_b;

  insert into public.savings_goals (user_id, goal_name) values (ua, 'A') returning goal_id into goal_a;
  insert into public.savings_goals (user_id, goal_name) values (ub, 'B') returning goal_id into goal_b;

  insert into public.investment_transactions (user_id, asset_type, transaction_type, investment_date, amount_vnd)
    values (ua, 'bank', 'investment', '2026-01-01', 100) returning transaction_id into tx_a;
  insert into public.investment_transactions (user_id, asset_type, transaction_type, investment_date, amount_vnd)
    values (ub, 'bank', 'investment', '2026-01-01', 100) returning transaction_id into tx_b;

  insert into public.recurring_savings (user_id, name, amount_vnd) values (ua, 'A', 10) returning saving_id into rec_a;
  insert into public.recurring_savings (user_id, name, amount_vnd) values (ub, 'B', 10) returning saving_id into rec_b;

  -- ── plan-scoped ────────────────────────────────────────────────────────────
  -- 1) plan_insurance_member_overrides.member_id
  insert into public.plan_insurance_member_overrides (plan_id, member_id, monthly_amount_override_vnd)
    values (plan_a, mem_a, 10);
  ok := false;
  begin
    insert into public.plan_insurance_member_overrides (plan_id, member_id, monthly_amount_override_vnd)
      values (plan_a, mem_b, 10);
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'plan_insurance_member_overrides.member_id accepted a foreign member'; end if;

  -- 2) plan_excluded_insurance_members.member_id
  insert into public.plan_excluded_insurance_members (plan_id, member_id) values (plan_a, mem_a);
  ok := false;
  begin
    insert into public.plan_excluded_insurance_members (plan_id, member_id) values (plan_a, mem_b);
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'plan_excluded_insurance_members.member_id accepted a foreign member'; end if;

  -- 3) fixed_expense_overrides.fixed_expense_id
  insert into public.fixed_expense_overrides (plan_id, fixed_expense_id, monthly_amount_override_vnd)
    values (plan_a, exp_a, 10);
  ok := false;
  begin
    insert into public.fixed_expense_overrides (plan_id, fixed_expense_id, monthly_amount_override_vnd)
      values (plan_a, exp_b, 10);
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'fixed_expense_overrides.fixed_expense_id accepted a foreign expense'; end if;

  -- 4) recurring_saving_overrides.recurring_saving_id
  insert into public.recurring_saving_overrides (plan_id, recurring_saving_id, monthly_amount_override_vnd)
    values (plan_a, rec_a, 10);
  ok := false;
  begin
    insert into public.recurring_saving_overrides (plan_id, recurring_saving_id, monthly_amount_override_vnd)
      values (plan_a, rec_b, 10);
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'recurring_saving_overrides.recurring_saving_id accepted a foreign saving'; end if;

  -- 5) plan_dca_skips.fund_id
  insert into public.plan_dca_skips (plan_id, fund_id) values (plan_a, fund_a);
  ok := false;
  begin
    insert into public.plan_dca_skips (plan_id, fund_id) values (plan_a, fund_b);
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'plan_dca_skips.fund_id accepted a foreign fund'; end if;

  -- ── user-scoped ────────────────────────────────────────────────────────────
  -- 6) insurance_savings.insurance_member_id
  insert into public.insurance_savings (user_id, insurance_member_id, amount_saved_vnd) values (ua, mem_a, 10);
  ok := false;
  begin
    insert into public.insurance_savings (user_id, insurance_member_id, amount_saved_vnd) values (ua, mem_b, 10);
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'insurance_savings.insurance_member_id accepted a foreign member'; end if;

  -- 7) recurring_savings.goal_id
  insert into public.recurring_savings (user_id, name, amount_vnd, goal_id) values (ua, 'ok', 10, goal_a);
  ok := false;
  begin
    insert into public.recurring_savings (user_id, name, amount_vnd, goal_id) values (ua, 'bad', 10, goal_b);
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'recurring_savings.goal_id accepted a foreign goal'; end if;

  -- 8) recurring_savings.linked_deposit_tx_id
  insert into public.recurring_savings (user_id, name, amount_vnd, linked_deposit_tx_id) values (ua, 'ok2', 10, tx_a);
  ok := false;
  begin
    insert into public.recurring_savings (user_id, name, amount_vnd, linked_deposit_tx_id) values (ua, 'bad2', 10, tx_b);
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'recurring_savings.linked_deposit_tx_id accepted a foreign transaction'; end if;

  -- 9) recurring_saving_fulfillments.recurring_saving_id
  insert into public.recurring_saving_fulfillments (user_id, recurring_saving_id, ym, amount_vnd)
    values (ua, rec_a, '2026-01', 10);
  ok := false;
  begin
    insert into public.recurring_saving_fulfillments (user_id, recurring_saving_id, ym, amount_vnd)
      values (ua, rec_b, '2026-02', 10);
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'recurring_saving_fulfillments.recurring_saving_id accepted a foreign saving'; end if;

  -- ── UPDATE must be guarded too, not just INSERT ─────────────────────────────
  ok := false;
  begin
    update public.recurring_savings set goal_id = goal_b where saving_id = rec_a;
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'recurring_savings.goal_id accepted a foreign goal on UPDATE'; end if;

  ok := false;
  begin
    update public.plan_dca_skips set fund_id = fund_b where plan_id = plan_a;
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'plan_dca_skips.fund_id accepted a foreign fund on UPDATE'; end if;

  -- ── the other side of the invariant: an owner can't move ───────────────────
  -- The triggers above guard the REFERENCING row. They can't see the referenced
  -- row — or a plan — being handed to another user, which would break the same
  -- invariant from the other direction and leave the children pointing at the
  -- previous owner's records. Nothing in the app ever reassigns user_id, so it's
  -- immutable rather than re-validated.
  ok := false;
  begin
    update public.monthly_plans set user_id = ub where id = plan_a;
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'monthly_plans.user_id must be immutable'; end if;

  ok := false;
  begin
    update public.insurance_members set user_id = ub where member_id = mem_a;
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'insurance_members.user_id must be immutable'; end if;

  ok := false;
  begin
    update public.savings_goals set user_id = ub where goal_id = goal_a;
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'savings_goals.user_id must be immutable'; end if;

  -- …while ordinary updates to those rows keep working.
  update public.monthly_plans set salary_vnd = 2000 where id = plan_a;
  update public.insurance_members set annual_payment_vnd = 240 where member_id = mem_a;

  -- ── nulls stay allowed: these references are optional ───────────────────────
  insert into public.recurring_savings (user_id, name, amount_vnd, goal_id, linked_deposit_tx_id)
    values (ua, 'unassigned', 10, null, null);

  raise notice 'fk_ownership_all.test.sql: OK';
end $$;

rollback;
