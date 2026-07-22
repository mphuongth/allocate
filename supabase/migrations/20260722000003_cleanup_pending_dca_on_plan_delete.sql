-- When a monthly plan is deleted, its pending auto-seeded DCA rows must go with
-- it (#472, sibling of #473).
--
-- investment_transactions.plan_id is ON DELETE SET NULL so a *recorded* purchase
-- survives the plan (just unlinked). But a pending seeded DCA row
-- (is_dca_seeded = true, units IS NULL) is planning state, not financial
-- history — SET NULL would leave it as an orphan with no plan that still leaks
-- through the transaction/history API and goal stats, and repeated
-- create/delete cycles accumulate more.
--
-- A BEFORE DELETE trigger removes exactly those pending rows in the same
-- transaction as the plan delete, so the whole operation stays atomic (a failure
-- anywhere rolls back the plan, the pending rows, and every cascaded child), and
-- it fires for every deletion path, not just the API route. Recorded rows are
-- untouched and still detach via the existing FK.

create or replace function public.cleanup_plan_pending_dca()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.investment_transactions
   where plan_id = old.id
     and user_id = old.user_id
     and asset_type = 'fund'
     and is_dca_seeded
     and units is null;
  return old;
end;
$$;

drop trigger if exists monthly_plans_cleanup_pending_dca on public.monthly_plans;
create trigger monthly_plans_cleanup_pending_dca
  before delete on public.monthly_plans
  for each row
  execute function public.cleanup_plan_pending_dca();
