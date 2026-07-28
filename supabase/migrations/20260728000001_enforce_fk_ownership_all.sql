-- Same-user ownership for every remaining user-owned FK (#525).
--
-- #474 put ownership triggers on investment_transactions and funds. Nine other
-- references were left validating only the row's own scope: RLS checks the row's
-- user_id (or its plan's), and a Postgres FK only checks that the target exists.
-- Neither stops a writer pointing at a row owned by somebody else, so a caller
-- who knows a foreign UUID could attach it — probing existence, and letting one
-- user's delete cascade into another's data.
--
-- Two shapes, so two functions. Both are parameterised through TG_ARGV rather
-- than written out nine times: the arguments are fixed here in the migration,
-- never caller input, and one implementation is one place to be correct.
--
-- SECURITY DEFINER with an explicit owner comparison, matching #474. The check
-- is deliberately "these two rows have the same owner" rather than anything
-- involving auth.uid(): that holds for service-role and RPC writes too, where
-- there is no authenticated user to compare against.

-- ─── plan-scoped: owner resolved through monthly_plans ────────────────────────
-- tg_argv = (fk column, referenced table, referenced pk column)
create or replace function public.enforce_plan_scoped_fk_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fk_col  text := tg_argv[0];
  v_ref_tbl text := tg_argv[1];
  v_ref_pk  text := tg_argv[2];
  v_ref_id  uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
  v_owner   uuid;
  v_ok      boolean;
begin
  -- These references are optional; a null one has no owner to disagree with.
  if v_ref_id is null then return new; end if;

  select user_id into v_owner from public.monthly_plans where id = new.plan_id;
  if v_owner is null then
    raise exception 'plan % does not exist', new.plan_id using errcode = 'check_violation';
  end if;

  execute format(
    'select exists (select 1 from public.%I where %I = $1 and user_id = $2)',
    v_ref_tbl, v_ref_pk
  ) into v_ok using v_ref_id, v_owner;

  if not v_ok then
    raise exception '%.% % does not belong to the plan owner', tg_table_name, v_fk_col, v_ref_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ─── user-scoped: owner is the row's own user_id ──────────────────────────────
create or replace function public.enforce_user_scoped_fk_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fk_col  text := tg_argv[0];
  v_ref_tbl text := tg_argv[1];
  v_ref_pk  text := tg_argv[2];
  v_ref_id  uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
  v_ok      boolean;
begin
  if v_ref_id is null then return new; end if;

  execute format(
    'select exists (select 1 from public.%I where %I = $1 and user_id = $2)',
    v_ref_tbl, v_ref_pk
  ) into v_ok using v_ref_id, new.user_id;

  if not v_ok then
    raise exception '%.% % does not belong to the row owner', tg_table_name, v_fk_col, v_ref_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ─── triggers ─────────────────────────────────────────────────────────────────
-- `update of <fk>, <owner col>` so re-pointing the reference OR moving the row
-- to another owner both re-run the check; neither alone is enough.

drop trigger if exists plan_insurance_member_overrides_fk_ownership on public.plan_insurance_member_overrides;
create trigger plan_insurance_member_overrides_fk_ownership
  before insert or update of member_id, plan_id on public.plan_insurance_member_overrides
  for each row execute function public.enforce_plan_scoped_fk_ownership('member_id', 'insurance_members', 'member_id');

drop trigger if exists plan_excluded_insurance_members_fk_ownership on public.plan_excluded_insurance_members;
create trigger plan_excluded_insurance_members_fk_ownership
  before insert or update of member_id, plan_id on public.plan_excluded_insurance_members
  for each row execute function public.enforce_plan_scoped_fk_ownership('member_id', 'insurance_members', 'member_id');

drop trigger if exists fixed_expense_overrides_fk_ownership on public.fixed_expense_overrides;
create trigger fixed_expense_overrides_fk_ownership
  before insert or update of fixed_expense_id, plan_id on public.fixed_expense_overrides
  for each row execute function public.enforce_plan_scoped_fk_ownership('fixed_expense_id', 'fixed_expenses', 'expense_id');

drop trigger if exists recurring_saving_overrides_fk_ownership on public.recurring_saving_overrides;
create trigger recurring_saving_overrides_fk_ownership
  before insert or update of recurring_saving_id, plan_id on public.recurring_saving_overrides
  for each row execute function public.enforce_plan_scoped_fk_ownership('recurring_saving_id', 'recurring_savings', 'saving_id');

drop trigger if exists plan_dca_skips_fk_ownership on public.plan_dca_skips;
create trigger plan_dca_skips_fk_ownership
  before insert or update of fund_id, plan_id on public.plan_dca_skips
  for each row execute function public.enforce_plan_scoped_fk_ownership('fund_id', 'funds', 'id');

drop trigger if exists insurance_savings_fk_ownership on public.insurance_savings;
create trigger insurance_savings_fk_ownership
  before insert or update of insurance_member_id, user_id on public.insurance_savings
  for each row execute function public.enforce_user_scoped_fk_ownership('insurance_member_id', 'insurance_members', 'member_id');

-- recurring_savings carries two independent references, so it gets two triggers
-- rather than a function that has to know about pairs.
drop trigger if exists recurring_savings_goal_fk_ownership on public.recurring_savings;
create trigger recurring_savings_goal_fk_ownership
  before insert or update of goal_id, user_id on public.recurring_savings
  for each row execute function public.enforce_user_scoped_fk_ownership('goal_id', 'savings_goals', 'goal_id');

drop trigger if exists recurring_savings_deposit_fk_ownership on public.recurring_savings;
create trigger recurring_savings_deposit_fk_ownership
  before insert or update of linked_deposit_tx_id, user_id on public.recurring_savings
  for each row execute function public.enforce_user_scoped_fk_ownership('linked_deposit_tx_id', 'investment_transactions', 'transaction_id');

drop trigger if exists recurring_saving_fulfillments_fk_ownership on public.recurring_saving_fulfillments;
create trigger recurring_saving_fulfillments_fk_ownership
  before insert or update of recurring_saving_id, user_id on public.recurring_saving_fulfillments
  for each row execute function public.enforce_user_scoped_fk_ownership('recurring_saving_id', 'recurring_savings', 'saving_id');

-- ─── the other side of the invariant ──────────────────────────────────────────
-- The triggers above guard the REFERENCING row. They can't see the referenced
-- row — or a plan — being handed to a different user, which breaks the same
-- invariant from the other direction: the children keep pointing at the previous
-- owner's records, and a later cascade from those records reaches into the new
-- owner's data.
--
-- Re-validating every child on an ownership change would mean five lookups per
-- plan transfer and an equivalent sweep for each referenced table. Immutability
-- is both cheaper and closer to the truth: nothing in this app ever reassigns
-- user_id. Rows are created by their owner and removed with them via
-- `on delete cascade`. An operator who genuinely needs to move data between
-- accounts has to drop this deliberately — a reasonable speed bump for an
-- operation that would otherwise silently corrupt ownership.
create or replace function public.reject_owner_change()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception '%.user_id is immutable (#525)', tg_table_name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    -- the plan-scoped parent
    'monthly_plans',
    -- referenced by the nine relationships
    'insurance_members', 'fixed_expenses', 'funds', 'savings_goals',
    'investment_transactions', 'recurring_savings',
    -- referencing rows that carry their own owner
    'insurance_savings', 'recurring_saving_fulfillments'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_owner_immutable', t);
    execute format(
      'create trigger %I before update of user_id on public.%I for each row execute function public.reject_owner_change()',
      t || '_owner_immutable', t
    );
  end loop;
end;
$$;

comment on function public.reject_owner_change() is
  'Rejects any change to a row''s user_id. Ownership is set once at insert; letting it move would break the same-owner FK invariant from the parent side (#525).';

comment on function public.enforce_plan_scoped_fk_ownership() is
  'Rejects a plan-scoped row whose referenced record belongs to a different user than the plan owner (#525).';
comment on function public.enforce_user_scoped_fk_ownership() is
  'Rejects a row whose referenced record belongs to a different user than the row owner (#525).';
