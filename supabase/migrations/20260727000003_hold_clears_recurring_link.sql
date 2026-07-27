-- Clear a recurring saving's deposit link when its source is held for merge (#531).
--
-- Creating a held-for-merge settlement closes the source deposit. A recurring
-- saving still pointing at that source via linked_deposit_tx_id would go on
-- trying to top up a settled deposit, so the link has to go at the same moment.
--
-- The route did this as a second statement after the insert, discarded its
-- result, and returned 201 either way. A failed cleanup therefore left a
-- dangling link behind a success response, and there was no transaction boundary
-- around the pair at all.
--
-- A trigger is the smaller fix than an RPC here. The insert has ~20 columns, so
-- an RPC would mean threading every one of them through a parameter list purely
-- to gain a transaction — while AFTER INSERT already runs inside the insert's
-- own transaction. The pair commits or rolls back together by construction, and
-- the guarantee now covers every writer (this route, a future endpoint, a
-- service-role script), not just the one code path that remembered to do it.
--
-- Scope is deliberately narrow: held_for_merge with a parent. A plain withdrawal
-- does not close the source for merge and must leave the link intact. The merge
-- RPC's own live-source cleanup (20260620000005) is untouched — it inserts plain
-- withdrawals, not held ones, so this trigger never fires for it and there is no
-- double work.
--
-- SECURITY DEFINER with an explicit user_id filter, matching the FK-ownership
-- triggers: the cleanup is authoritative regardless of the caller's RLS
-- visibility, and can only ever touch the inserting row's own owner.

create or replace function public.clear_recurring_link_on_hold()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.recurring_savings
     set linked_deposit_tx_id = null,
         updated_at = now()
   where linked_deposit_tx_id = new.parent_transaction_id
     and user_id = new.user_id;
  return null; -- AFTER trigger: the return value is ignored
end;
$$;

drop trigger if exists investment_transactions_hold_clears_link on public.investment_transactions;
create trigger investment_transactions_hold_clears_link
  after insert on public.investment_transactions
  for each row
  when (new.held_for_merge and new.parent_transaction_id is not null)
  execute function public.clear_recurring_link_on_hold();

comment on function public.clear_recurring_link_on_hold() is
  'Unlinks any recurring saving feeding a deposit that has just been held for merge, inside the settlement insert''s own transaction (#531).';
