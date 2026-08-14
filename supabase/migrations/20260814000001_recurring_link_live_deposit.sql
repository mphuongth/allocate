-- A recurring saving may not be linked to a deposit that is closed.
--
-- enforce_recurring_link_not_handed_over (#638, last redefined in
-- 20260812000001) locks the target and asks two questions: has it handed over to
-- a successor, and has it been folded into another deposit? It never asks the
-- plainest one — is it still there to fund?
--
-- So a saving can be linked to a book that has been settled whole. The close
-- clears deposit_group_id on every row, which also slips past the API's "link a
-- book via its anchor" check, and record_recurring_book_topup then fails every
-- month with "accumulating book not found" while the plan goes on showing a
-- link. Reproduced with nothing exotic: close a book through the ordinary
-- withdraw sheet, link a saving to the dead anchor, accepted.
--
-- The guard already carries the rule it was missing, in its own comment: "a link
-- that can never be funded is worse than a refused one — the plan would keep
-- asking for a month it has nowhere to put." A closed deposit is that, exactly.
--
-- ─── Asked of the BOOK, not of the anchor ────────────────────────────────────
--
-- A link names a book's anchor but funds the GROUP, and the anchor is only one
-- tranche. A partial withdrawal can empty it — by rounding, or taken against
-- that tranche directly — while the book carries on with the rest. Reading the
-- anchor's own balance would refuse a link to a book that is very much alive, so
-- a live book is measured across its live tranches. A book settled whole has had
-- deposit_group_id cleared everywhere, so its anchor is measured on its own and
-- reads zero — which is the case this guard exists for.
-- What a link can still be funded from, in ONE place. Three readers need it and
-- they must agree: the guard below (refusing a new link), the unlinker (a
-- withdrawal that closes the target), and the repair (links that predate both).
-- A book is measured across its live tranches; anything else on its own row.
-- Null when the deposit is gone — a deleted target is the delete trigger's
-- business (#655), not this one's.
--
-- A withdrawal keyed by a fund draws on that (goal, fund) bucket and NOT on the
-- deposit it happens to name as parent — the precedence check_withdrawal_balance
-- applies (#606), for a shape the POST route accepts and old rows carry.
-- Counting it here charged a fund sale to a bank deposit: a big enough sale made
-- a live deposit read as closed, which would have had the trigger below cut a
-- perfectly good link and the API refuse a perfectly good one.
create or replace function public.deposit_link_fundable_principal(p_tx_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when t.deposit_group_id = t.transaction_id then (
      select coalesce(sum(
               x.amount_vnd - coalesce((
                 select sum(w.principal_withdrawn) from public.investment_transactions w
                  where w.parent_transaction_id = x.transaction_id
                    and w.transaction_type = 'withdrawal'
                    and not coalesce(w.asset_type = 'fund' and w.fund_id is not null, false)
               ), 0)
             ), 0)
        from public.investment_transactions x
       where x.deposit_group_id = t.transaction_id
         and x.transaction_type = 'investment'
         and x.renewed_from_transaction_id is null)
    else t.amount_vnd - coalesce((
      select sum(w.principal_withdrawn) from public.investment_transactions w
       where w.parent_transaction_id = t.transaction_id
         and w.transaction_type = 'withdrawal'
         and not coalesce(w.asset_type = 'fund' and w.fund_id is not null, false)
    ), 0)
  end
    from public.investment_transactions t
   where t.transaction_id = p_tx_id;
$$;

comment on function public.deposit_link_fundable_principal(uuid) is
  'Principal a recurring link could still be funded into: the whole group for a book, the row itself otherwise. Null if the deposit is gone.';

revoke all on function public.deposit_link_fundable_principal(uuid) from public, anon, authenticated;

create or replace function public.enforce_recurring_link_not_handed_over()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_target public.investment_transactions;
  v_folded boolean;
  v_left bigint;
begin
  -- LOCK the target, THEN read it. Locking inside a predicate that already tests
  -- the successor locks nothing while a handover is uncommitted: the visible
  -- version still has a null link, so the row does not match and the write sails
  -- past to commit against a book that, moments later, refuses it. The lock has
  -- to be taken on the row itself, whatever it currently says — and the same
  -- reasoning covers a liquidation committing underneath this write.
  select * into v_target
    from public.investment_transactions
   where transaction_id = new.linked_deposit_tx_id
     and user_id = new.user_id
   for share;
  if not found then return new; end if;

  if v_target.successor_deposit_tx_id is not null then
    raise exception 'successor book: that book has handed over to a successor, so link the successor instead'
      using errcode = 'check_violation';
  end if;

  select exists (
    select 1 from public.investment_transactions w
     where w.parent_transaction_id = v_target.transaction_id
       and w.transaction_type = 'withdrawal'
       and w.consumed_by_inv_id is not null
  ) into v_folded;
  if v_folded then
    raise exception 'successor book: that deposit has been folded into another one, so link that one instead'
      using errcode = 'check_violation';
  end if;

  if v_target.deposit_group_id = v_target.transaction_id then
    -- A live accumulating book, which is measured across the GROUP.
    --
    -- LOCK every live tranche before measuring them, not just the anchor. The
    -- withdrawal invariant (check_withdrawal_balance, 20260730000002) locks only
    -- the row a withdrawal names as its parent, so a close of the book's last
    -- non-anchor tranche never touches the anchor and never waits here: this
    -- query would miss that uncommitted withdrawal, accept the link, and leave it
    -- pointing at a book both transactions have just emptied.
    --
    -- Ordered by transaction_id, the same order check_withdrawal_balance takes
    -- its locks in, so the two cannot deadlock.
    perform 1
      from public.investment_transactions t
     where t.deposit_group_id = v_target.transaction_id
       and t.transaction_type = 'investment'
       and t.renewed_from_transaction_id is null
     order by t.transaction_id
       for share;

  end if;

  v_left := public.deposit_link_fundable_principal(v_target.transaction_id);

  if v_left <= 0 then
    raise exception 'closed deposit: that deposit has been closed, so a link to it could never be funded'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_recurring_link_not_handed_over() is
  'Refuses a recurring link to a deposit that cannot be funded: handed over, folded into another, or closed.';

-- SECURITY DEFINER, so it is executable by PUBLIC unless told otherwise. It is
-- the trigger''s helper and nothing else''s (mirrors 20260812000001).
revoke all on function public.enforce_recurring_link_not_handed_over() from public, anon, authenticated;

-- ─── The other way in: the deposit closes under a link that was valid ────────
--
-- Guarding the link write only covers half the invariant. A saving linked to a
-- live deposit turns invalid the moment that deposit is emptied, and closing it
-- is an ordinary withdrawal — no link column is written, so the guard above never
-- runs. Two closing paths already unlink: withdraw_accumulating_book on a full
-- close (20260618000009) and the held-for-merge settlement (20260727000003). A
-- plain term deposit closed through the withdraw sheet had neither, and left the
-- saving pointing at a dead target for record_recurring_book_topup to fail on
-- every month.
--
-- Refusing the withdrawal instead is not on the table: the money is the user''s
-- and closing a deposit is not a mistake. The link is what has to give — and it
-- says so, with the same mark a deleted deposit leaves (#655), so the plan can
-- tell the user their routing stopped instead of silently dropping it.
--
-- held_for_merge rows are left to 20260727000003, which owns that case.
create or replace function public.clear_recurring_link_on_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The deposit whose balance may have just moved. A withdrawal moves the one it
  -- names; an investment moves its own — amount_vnd can be edited down to exactly
  -- what has been withdrawn (the balance invariant permits equality), which closes
  -- the deposit without any withdrawal being written at all.
  v_deposit uuid := case
    when new.transaction_type = 'withdrawal' then new.parent_transaction_id
    else new.transaction_id
  end;
  v_group uuid;
begin
  if v_deposit is null then return null; end if;

  -- The link names the book''s ANCHOR while a withdrawal (or an edit) names a
  -- tranche, so a close reached through any tranche has to look at the whole group.
  select t.deposit_group_id into v_group
    from public.investment_transactions t
   where t.transaction_id = v_deposit;

  update public.recurring_savings s
     set linked_deposit_tx_id = null,
         unlinked_at = now(),
         unlinked_from_book = (
           select x.deposit_group_id is not distinct from x.transaction_id
             from public.investment_transactions x
            where x.transaction_id = s.linked_deposit_tx_id
         ),
         updated_at = now()
   where s.user_id = new.user_id
     and (
       s.linked_deposit_tx_id = v_deposit
       or (v_group is not null and s.linked_deposit_tx_id in (
             select x.transaction_id from public.investment_transactions x
              where x.deposit_group_id = v_group))
     )
     -- Measured, not assumed: a withdrawal against one tranche of a live book
     -- closes nothing, and a partial one closes nothing either.
     and coalesce(public.deposit_link_fundable_principal(s.linked_deposit_tx_id), 1) <= 0;
  return null; -- AFTER trigger: the return value is ignored
end;
$$;

comment on function public.clear_recurring_link_on_close() is
  'Unlinks any recurring saving whose deposit a withdrawal has just emptied, and marks it so the plan can say the routing stopped (#655).';

revoke all on function public.clear_recurring_link_on_close() from public, anon, authenticated;

-- Every accepted edit that can empty a deposit, not just the obvious one.
-- Inserting a withdrawal is the common way in; raising principal_withdrawn on an
-- existing one does the same; re-parenting a withdrawal empties whatever it now
-- names; and moving a sale off its fund key (asset_type / fund_id) hands its
-- principal back to the parent, which the balance above then charges there.
drop trigger if exists investment_transactions_close_clears_link on public.investment_transactions;
create trigger investment_transactions_close_clears_link
  after insert or update of principal_withdrawn, parent_transaction_id, asset_type, fund_id
  on public.investment_transactions
  for each row
  when (new.transaction_type = 'withdrawal'
        and new.parent_transaction_id is not null
        and not coalesce(new.held_for_merge, false))
  execute function public.clear_recurring_link_on_close();

-- ...and from the source''s own side. Editing a deposit down to exactly what has
-- been withdrawn closes it with no withdrawal written at all — the balance
-- invariant permits equality — and the trigger above would never see it.
-- deposit_group_id too: leaving the group makes a tranche a deposit measured on
-- its own, which may be nothing.
drop trigger if exists investment_transactions_shrink_clears_link on public.investment_transactions;
create trigger investment_transactions_shrink_clears_link
  after update of amount_vnd, deposit_group_id on public.investment_transactions
  for each row
  when (new.transaction_type = 'investment')
  execute function public.clear_recurring_link_on_close();

-- ─── ...and the links that are already wrong ─────────────────────────────────
--
-- Neither trigger touches a row nobody writes to. A deployment carrying the
-- state this migration forbids would carry it forever, because the deposit is
-- already closed and the link is already made. A function rather than loose DML
-- so the repair is testable against a state that is otherwise unreachable once
-- the trigger above exists.
create or replace function public.repair_closed_recurring_links()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_repaired integer;
begin
  update public.recurring_savings s
     set linked_deposit_tx_id = null,
         unlinked_at = now(),
         unlinked_from_book = (
           select x.deposit_group_id is not distinct from x.transaction_id
             from public.investment_transactions x
            where x.transaction_id = s.linked_deposit_tx_id
         ),
         updated_at = now()
   where s.linked_deposit_tx_id is not null
     -- Null = the deposit is gone, which the delete trigger already marked.
     and coalesce(public.deposit_link_fundable_principal(s.linked_deposit_tx_id), 1) <= 0;
  get diagnostics v_repaired = row_count;
  return v_repaired;
end;
$$;

comment on function public.repair_closed_recurring_links() is
  'One-off repair for links made before closing a deposit unlinked its savings; kept callable so it can be tested and re-run.';

revoke all on function public.repair_closed_recurring_links() from public, anon, authenticated;

select public.repair_closed_recurring_links();
