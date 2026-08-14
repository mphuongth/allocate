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
  --
  -- FOR UPDATE, and on this row ONLY. An earlier version also share-locked every
  -- live tranche, so that a close of the book's last non-anchor tranche — which
  -- check_withdrawal_balance never makes touch the anchor — could not slip past
  -- this measurement. That lock is what put the two paths in opposite orders:
  -- this one takes the anchor and then the tranches, while an ordinary withdrawal
  -- holds its tranche (from the balance check) and then waits for the anchor in
  -- clear_recurring_link_on_close. A cycle, and a 40P01 for whichever side loses.
  --
  -- It is also no longer needed. The state it guarded against — a link accepted
  -- onto a book a concurrent withdrawal has just emptied — is now repaired from
  -- the other side: that withdrawal's unlinker takes this same anchor, so it runs
  -- after this write and clears the link it finds. Whichever way the two
  -- interleave, the book and the link agree at the end. One row, one lock, one
  -- order (asserted by the link-vs-close race in recurring_link_close_race).
  select * into v_target
    from public.investment_transactions
   where transaction_id = new.linked_deposit_tx_id
     and user_id = new.user_id
   for update;
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

-- ─── Why the link went, not just that it did ────────────────────────────────
--
-- unlinked_at meant one thing until now: the deposit was DELETED (#655), and the
-- plan says so in as many words — "Sổ đã bị xoá" / "Deposit deleted". The
-- unlinker below reuses the mark for a deposit that was fully withdrawn, which
-- is a different thing: the deposit is still there, on the ledger, in the
-- history. Reusing the mark without saying which is which would have the plan
-- tell users their deposit was deleted when nobody deleted anything.
alter table public.recurring_savings
  add column if not exists unlinked_reason text;

alter table public.recurring_savings
  drop constraint if exists recurring_savings_unlinked_reason_check;
alter table public.recurring_savings
  add constraint recurring_savings_unlinked_reason_check
  check (unlinked_reason is null or unlinked_reason in ('deleted', 'closed'));

comment on column public.recurring_savings.unlinked_reason is
  'Why the link went: ''deleted'' (the deposit was removed, #655) or ''closed'' (it was fully withdrawn, #650). Advisory: it only decides which sentence the plan shows.';

-- Every stamp that exists today was written by the delete trigger, because it
-- was the only thing that wrote one.
update public.recurring_savings
   set unlinked_reason = 'deleted'
 where unlinked_at is not null
   and unlinked_reason is null;

-- Verbatim from 20260812000002 apart from the reason it now records.
create or replace function public.mark_saving_link_lost()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Deleting the account cascades to both tables, and the saving being marked is
  -- itself on its way out. Writing to it then re-checks its owner FK against a
  -- `auth.users` row the cascade has already removed, which aborts the account
  -- deletion over an advisory flag. Nobody is left to read the warning, so skip
  -- it: the owner still existing is what makes the mark worth writing.
  update public.recurring_savings
     set unlinked_at = now(),
         unlinked_reason = 'deleted',
         -- An anchor is a book: deposit_group_id pointing at its own row. A
         -- plain term deposit has no group at all, and the link validator
         -- accepts nothing in between.
         unlinked_from_book = (old.deposit_group_id is not distinct from old.transaction_id),
         updated_at = now()
   where linked_deposit_tx_id = old.transaction_id
     and user_id = old.user_id
     and exists (select 1 from auth.users u where u.id = old.user_id);
  return old;
end;
$$;

-- Re-linking clears the whole mark, reason included.
create or replace function public.clear_saving_unlinked_mark()
returns trigger
language plpgsql
as $$
begin
  new.unlinked_at := null;
  new.unlinked_from_book := null;
  new.unlinked_reason := null;
  return new;
end;
$$;

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
    when new.transaction_type = 'investment' then new.transaction_id
  end;
  v_group uuid;
begin
  -- A row can stop being a deposit at all: give it a parent and a principal and
  -- call it a withdrawal, and the balance invariants accept it (it is measured
  -- against its new parent) while any saving linked to it is left pointing at
  -- something that is not an investment — a link the guard would refuse outright
  -- if it were being written now. Nothing about the balance is in question here,
  -- so nothing is measured: the target is simply gone as a deposit.
  if tg_op = 'UPDATE'
     and old.transaction_type = 'investment'
     and new.transaction_type is distinct from 'investment' then
    update public.recurring_savings s
       set linked_deposit_tx_id = null,
           unlinked_at = now(),
           unlinked_reason = 'closed',
           unlinked_from_book = (old.deposit_group_id is not distinct from old.transaction_id),
           updated_at = now()
     where s.user_id = new.user_id
       and s.linked_deposit_tx_id = new.transaction_id;
  end if;

  if v_deposit is null then return null; end if;

  -- The link names the book''s ANCHOR while a withdrawal (or an edit) names a
  -- tranche, so a close reached through any tranche has to look at the whole group.
  select t.deposit_group_id into v_group
    from public.investment_transactions t
   where t.transaction_id = v_deposit;

  -- SERIALISE ON THE BOOK before measuring it. check_withdrawal_balance locks
  -- only the row a withdrawal names as its parent (20260730000002), so two closes
  -- against DIFFERENT tranches of one book never meet: each would measure the
  -- group on its own snapshot, see the other tranche''s principal as still there,
  -- and leave the link alone — and both commit, on a book with nothing in it.
  --
  -- The anchor, exclusively, and nothing else. FOR SHARE would let both sessions
  -- hold it at once and prove nothing. Locking the tranches instead would put two
  -- plain withdrawals in a cycle (each already holds the one it is drawing from),
  -- while the anchor is a single row neither of them holds beforehand: one waits
  -- for the other to commit and then measures a book that is genuinely empty.
  --
  -- The one cycle this leaves is against withdraw_accumulating_book, which holds
  -- the anchor and then locks each tranche in turn — the reverse order — so a full
  -- book close running at the same time as a manual withdrawal from one of its
  -- tranches can deadlock. That is a loud, retryable 40P01 that writes nothing,
  -- traded for a silent wrong state that persists; and the BEFORE trigger owns the
  -- tranche lock, so there is no order this trigger could take that would agree
  -- with both callers.
  if v_group is not null then
    perform 1 from public.investment_transactions t
      where t.transaction_id = v_group
        for update;
  end if;

  update public.recurring_savings s
     set linked_deposit_tx_id = null,
         unlinked_at = now(),
         unlinked_reason = 'closed',
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
-- names; moving a sale off its fund key (asset_type / fund_id) hands its
-- principal back to the parent, which the balance above then charges there; and
-- transaction_type ACTIVATES a row staged as an investment carrying a parent and
-- a principal_withdrawn — which draws nothing down, so nothing measures it — in a
-- one-column update. check_withdrawal_balance names that last path in its own
-- trigger comment and watches the column for exactly this reason.
drop trigger if exists investment_transactions_close_clears_link on public.investment_transactions;
create trigger investment_transactions_close_clears_link
  after insert or update of
    transaction_type, principal_withdrawn, parent_transaction_id, asset_type, fund_id
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
-- transaction_type as well, and fired on the way OUT of 'investment' too: a row
-- that stops being a deposit takes its links with it.
drop trigger if exists investment_transactions_shrink_clears_link on public.investment_transactions;
create trigger investment_transactions_shrink_clears_link
  after update of amount_vnd, deposit_group_id, transaction_type
  on public.investment_transactions
  for each row
  when (new.transaction_type = 'investment' or old.transaction_type = 'investment')
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
         unlinked_reason = 'closed',
         -- Unknown, not false. A book settled through withdraw_accumulating_book
         -- has had deposit_group_id cleared on every tranche, so a former anchor
         -- and a plain term deposit are the same row by the time this runs — the
         -- provenance is gone, and these are precisely the rows this repair is
         -- for. Recorded as null, the plan says the true half (the deposit is
         -- closed, pick another) and leaves out the half it cannot know. Claiming
         -- false would be the same lie in the other direction: it tells a book''s
         -- owner nothing changed about where the monthly money goes, when it did.
         unlinked_from_book = (
           select case when x.deposit_group_id = x.transaction_id then true end
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
