-- Database-level defense in depth for FK ownership (#474): even a writer that
-- bypasses the API (service role, a future endpoint that forgets the check)
-- must not be able to link a fund_id / goal_id / dca_goal_id owned by a
-- different user. Triggers enforce that the referenced row shares the writing
-- row's user_id.
--
-- Runs against the local stack inside a rolled-back transaction. Any failed
-- assertion RAISEs and, under `psql -v ON_ERROR_STOP=1`, exits non-zero.
-- Run via `npm run test:db`.

begin;

do $$
declare
  v_a uuid;
  v_b uuid;
  v_goal_a uuid;
  v_fund_a uuid;
  v_goal_b uuid;
  v_fund_b uuid;
  v_raised boolean;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'owner-a@test.invalid') returning id into v_a;
  insert into auth.users (id, email) values (gen_random_uuid(), 'owner-b@test.invalid') returning id into v_b;
  insert into public.savings_goals (user_id, goal_name) values (v_a, 'A goal') returning goal_id into v_goal_a;
  insert into public.funds (user_id, name, code, fund_type, nav) values (v_a, 'A fund', 'OWNA', 'equity', 20000) returning id into v_fund_a;
  insert into public.savings_goals (user_id, goal_name) values (v_b, 'B goal') returning goal_id into v_goal_b;
  insert into public.funds (user_id, name, code, fund_type, nav) values (v_b, 'B fund', 'OWNB', 'equity', 20000) returning id into v_fund_b;

  -- 1) B's transaction referencing A's fund must be rejected.
  v_raised := false;
  begin
    insert into public.investment_transactions (user_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id)
      values (v_b, 'fund', 'investment', '2099-01-01', 1000000, v_fund_a);
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'cross-user fund_id must be rejected'; end if;

  -- 2) B's transaction referencing A's goal must be rejected.
  v_raised := false;
  begin
    insert into public.investment_transactions (user_id, asset_type, transaction_type, investment_date, amount_vnd, goal_id)
      values (v_b, 'bank', 'investment', '2099-01-01', 1000000, v_goal_a);
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'cross-user goal_id must be rejected'; end if;

  -- 3) B's fund pointing dca_goal_id at A's goal must be rejected.
  v_raised := false;
  begin
    insert into public.funds (user_id, name, code, fund_type, nav, is_dca, dca_monthly_amount_vnd, dca_goal_id)
      values (v_b, 'B DCA fund', 'OWNBD', 'equity', 20000, true, 1000000, v_goal_a);
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'cross-user dca_goal_id must be rejected'; end if;

  -- 4) Updating one of B's own rows to point at A's fund must be rejected too.
  v_raised := false;
  declare v_tx uuid;
  begin
    insert into public.investment_transactions (user_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id)
      values (v_b, 'fund', 'investment', '2099-01-01', 1000000, v_fund_b) returning transaction_id into v_tx;
    begin
      update public.investment_transactions set fund_id = v_fund_a where transaction_id = v_tx;
    exception when others then v_raised := true; end;
    if not v_raised then raise exception 'cross-user fund_id on UPDATE must be rejected'; end if;
  end;

  -- 5) Legitimate same-owner references must succeed (no exception).
  insert into public.investment_transactions (user_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id, goal_id)
    values (v_b, 'fund', 'investment', '2099-01-01', 1000000, v_fund_b, v_goal_b);
  insert into public.funds (user_id, name, code, fund_type, nav, is_dca, dca_monthly_amount_vnd, dca_goal_id)
    values (v_b, 'B DCA ok', 'OWNBOK', 'equity', 20000, true, 1000000, v_goal_b);

  raise notice 'fk_ownership.test.sql: OK';
end $$;

rollback;
