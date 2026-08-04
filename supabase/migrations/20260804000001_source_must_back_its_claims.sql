-- A source may not be edited or deleted below what has already been withdrawn
-- from it (#608).
--
-- 20260730000002 measures a WITHDRAWAL against its holding every time the
-- withdrawal is written or moved, and says so in its own header: "lowering a
-- source's amount_vnd below what has already been withdrawn is the mirror hole
-- and wants its own guard". This is that guard. Nothing fired when the SOURCE
-- shrank, so
--
--   buy 100,000,000 → sell 80,000,000 → edit the buy down to 50,000,000
--
-- was accepted in silence. dashboard/overview then does
-- `totalInvested -= Σ principal_withdrawn` against a basis that no longer covers
-- it: invested capital goes negative, the goal's progress bar with it, and there
-- is no error and no screen that shows the inconsistency. You find it months
-- later from a number that looks wrong.
--
-- ─── One question, asked from the other end ──────────────────────────────────
--
-- The balances are the same two the withdrawal invariant already measures, and
-- the branch order is the same one lib/withdrawalProgress uses to decide which
-- bucket a claim draws on. Restating the arithmetic here would be a second
-- implementation of a decision table that must have exactly one, so this reuses
-- what is there:
--
--   • fund purchase (asset_type='fund', a fund, units > 0) — its bucket is
--     measured by check_fund_bucket_solvent, which since #606 counts every claim
--     the dashboard counts: fund-keyed sells AND withdrawals parented to a
--     purchase in the bucket.
--   • everything else (bank / gold / stock, and a fund row with no units, which
--     is no bucket) — one source row: amount_vnd and units must cover the claims
--     parented to it, summed exactly as check_withdrawal_balance's parent branch
--     sums them.
--
-- ─── Why the edit check is DEFERRED to commit ────────────────────────────────
--
-- Not a preference — renew_term_deposit_with_merge makes it necessary. It rolls
-- the deposit forward FIRST (`update ... set amount_vnd = p_amount_vnd +
-- v_merge_total`) and only two statements later re-parents that deposit's partial
-- withdrawals onto the history snapshot it just wrote (#585). Renewing a
-- 100,000,000 deposit that has 60,000,000 withdrawn from it at its remaining
-- balance leaves the row holding 41,000,000 against a 60,000,000 claim for the
-- length of two statements — legitimately insolvent in the middle, sound at the
-- end. A row-level or end-of-statement check refuses every such renewal.
--
-- So the edit is asked at COMMIT, which is the only boundary where a
-- multi-statement rewrite is a finished thought. That is the same reasoning
-- 20260731000001 already applies to the held-settlement source check, and the
-- price is the same: the error arrives at commit rather than at the statement.
-- For the single-statement writes the API makes, they are the same moment.
--
-- ─── Why deleting is guarded from the CHILD's side ───────────────────────────
--
-- Deleting a source could not be measured at commit the way an edit is: both
-- links a withdrawal hangs on are ON DELETE SET NULL, so by commit the child no
-- longer names the holding that went, and there is nothing left to measure
-- against. The tell has to be read while it is still there — during the FK's own
-- SET NULL update, which is the last moment anything knows what this row drew on.
-- enforce_withdrawal_within_balance already stands there and already tells
-- "detached by hand" (refused) from "orphaned by the FK" (waved through); the
-- refusal below is a trigger beside it, sorted to run first, so that function is
-- not copied a third time to gain four lines. That is the delete half of #607,
-- answered the same way as the edit because it is the same question.
--
-- The one shape that must still be let through is the account cascade: deleting a
-- user removes holdings and withdrawals in an order Postgres picks, so a child can
-- be orphaned by a parent that is on its way out too. The tell is the same one
-- that branch already uses for the parent — by the time the FK action fires, the
-- referenced auth.users row is deleted and invisible.
--
-- A fund purchase is different again: its sells name no parent, so deleting it
-- fires no FK update at all and there is nothing to catch. Its bucket answers
-- instead, at commit, where the deleted row has already left the sums.

-- ── the measurement ─────────────────────────────────────────────────────────
create or replace function public.check_source_backs_claims(src public.investment_transactions)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The units tolerance the rest of this family uses — clients round
  -- units_withdrawn to four decimals, so a FULL sell can post a hair more than
  -- the holding and the source is allowed to be restated at exactly that.
  -- Principal has NO tolerance, matching check_withdrawal_balance's parent branch:
  -- it compares `principal_withdrawn > v_left` outright, and a source that covers
  -- a đồng less than what left it is owing a đồng.
  c_units_epsilon constant numeric := 0.0001;
  v_out_principal bigint;
  v_out_units     numeric;
  v_have          bigint;
  v_have_units    numeric;
begin
  -- A fund purchase IS its bucket, and the bucket is what claims draw on. `units
  -- > 0` mirrors lib/withdrawalProgress exactly: a purchase with none is no
  -- bucket — the dashboard values it as an ordinary holding — so it falls through
  -- to the parent axis below, where its claims actually sit.
  if src.transaction_type = 'investment' and src.asset_type = 'fund'
     and src.fund_id is not null and coalesce(src.units, 0) > 0 then
    perform public.check_fund_bucket_solvent(src.user_id, src.fund_id, src.goal_id);
    return;
  end if;

  -- What is drawn on this row, summed the way check_withdrawal_balance's parent
  -- branch sums it — a fund-keyed sibling draws on its own bucket whatever it
  -- names as a parent, so counting it here would charge it twice.
  select coalesce(sum(w.principal_withdrawn), 0), coalesce(sum(w.units_withdrawn), 0)
    into v_out_principal, v_out_units
    from public.investment_transactions w
   where w.parent_transaction_id = src.transaction_id
     and w.transaction_type = 'withdrawal'
     and not coalesce(w.asset_type = 'fund' and w.fund_id is not null, false);

  if v_out_principal = 0 and v_out_units = 0 then return; end if;

  -- A row that is no longer an investment holds nothing at all: the dashboard
  -- values no balance for it, so every claim parented to it is unbacked. That is
  -- the same hole reached through transaction_type instead of amount_vnd, which
  -- is why the trigger watches that column too.
  v_have       := case when src.transaction_type = 'investment' then coalesce(src.amount_vnd, 0) else 0 end;
  v_have_units := case when src.transaction_type = 'investment' then coalesce(src.units, 0) else 0 end;

  if v_out_principal > v_have then
    raise exception 'withdrawal invariant: holding % would be left owing % it does not hold (% withdrawn against a balance of %)',
      src.transaction_id, v_out_principal - v_have, v_out_principal, v_have
      using errcode = 'check_violation';
  end if;

  if v_out_units > v_have_units + c_units_epsilon then
    raise exception 'withdrawal invariant: holding % would be left owing % units it does not hold (% units withdrawn against % held)',
      src.transaction_id, v_out_units - v_have_units, v_out_units, v_have_units
      using errcode = 'check_violation';
  end if;
end;
$$;

comment on function public.check_source_backs_claims(public.investment_transactions) is
  'Raises when a holding no longer covers the withdrawals drawn on it — the source side of the withdrawal invariant (#608).';

-- SECURITY DEFINER and PUBLIC-executable by default, which would make it an
-- oracle: hand it a row naming someone else''s holding and the refusal reports
-- that holding''s exact balance, RLS bypassed. Same reasoning, same revoke, as
-- check_withdrawal_balance.
revoke all on function public.check_source_backs_claims(public.investment_transactions) from public;
revoke all on function public.check_source_backs_claims(public.investment_transactions) from anon, authenticated;

-- ── an edit, measured once the transaction is a finished thought ────────────
create or replace function public.enforce_source_backs_claims()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.investment_transactions;
begin
  -- Re-read rather than trust the queued image: between the statement and commit
  -- the row may have been edited again or deleted outright, and the question is
  -- about what is actually there now. Gone means the delete triggers own it.
  select * into v_row from public.investment_transactions t
   where t.transaction_id = new.transaction_id;
  if not found then return null; end if;

  perform public.check_source_backs_claims(v_row);

  -- A purchase that LEFT a bucket — its fund cleared, its asset_type changed, its
  -- goal moved — shrinks the bucket it came from by everything it held, and the
  -- row above no longer knows anything about that bucket. Measure the old one too.
  -- Deleting the fund itself needs no exemption here: it clears fund_id on the
  -- purchases and the sells alike, so the old bucket is empty on both sides and
  -- the check is 0 against 0.
  if old.transaction_type = 'investment' and old.asset_type = 'fund'
     and old.fund_id is not null and coalesce(old.units, 0) > 0
     and (old.fund_id is distinct from new.fund_id
          or old.asset_type is distinct from new.asset_type
          or old.goal_id is distinct from new.goal_id
          or old.transaction_type is distinct from new.transaction_type) then
    perform public.check_fund_bucket_solvent(old.user_id, old.fund_id, old.goal_id);
  end if;

  return null;
end;
$$;

comment on function public.enforce_source_backs_claims() is
  'Re-measures a holding against the withdrawals drawn on it after an edit, at commit so a multi-statement rewrite (renewal, collapse) is seen finished (#608).';

revoke all on function public.enforce_source_backs_claims() from public, anon, authenticated;

drop trigger if exists investment_transactions_source_backs_claims on public.investment_transactions;
create constraint trigger investment_transactions_source_backs_claims
  after update of transaction_type, asset_type, amount_vnd, units, fund_id, goal_id
  on public.investment_transactions
  -- INITIALLY DEFERRED, not IMMEDIATE: renewal is insolvent between its own
  -- statements (see the header). A caller that needs the answer sooner can SET
  -- CONSTRAINTS IMMEDIATE, which is how the tests force it.
  deferrable initially deferred
  for each row
  -- Either side: a row that STOPS being an investment takes its balance away just
  -- as surely as one that shrinks.
  when (old.transaction_type = 'investment' or new.transaction_type = 'investment')
  execute function public.enforce_source_backs_claims();

-- ── deleting a fund purchase: the bucket answers ────────────────────────────
create or replace function public.enforce_source_delete_backs_claims()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- At commit the deleted row has already left both sums, so the bucket is
  -- measured as it will actually be read. An account cascade is 0 against 0 and
  -- passes; a goal delete moves purchases and sells to the unallocated bucket
  -- together and passes; what is refused is a delete that genuinely leaves sales
  -- with less behind them than they claim.
  perform public.check_fund_bucket_solvent(old.user_id, old.fund_id, old.goal_id);
  return null;
end;
$$;

comment on function public.enforce_source_delete_backs_claims() is
  'Re-measures a fund bucket at commit after one of its purchases is deleted — a fund sell names no parent, so nothing else catches it (#608).';

revoke all on function public.enforce_source_delete_backs_claims() from public, anon, authenticated;

drop trigger if exists investment_transactions_source_deleted on public.investment_transactions;
create constraint trigger investment_transactions_source_deleted
  after delete on public.investment_transactions
  deferrable initially deferred
  for each row
  when (old.transaction_type = 'investment' and old.asset_type = 'fund'
        and old.fund_id is not null and coalesce(old.units, 0) > 0)
  execute function public.enforce_source_delete_backs_claims();

-- ── deleting any other holding: caught as its children are orphaned ─────────
--
-- A trigger of its own rather than another branch inside
-- enforce_withdrawal_within_balance: that function has already been re-issued
-- once (20260803000002) and copying it again to add four lines makes a third
-- copy that drifts from the other two. This asks one question, and the ordering
-- it needs it gets for free — same-timing triggers fire in name order, and
-- `..._source_not_deletable...` sorts before `..._withdrawal_balance`, so the
-- refusal below happens before that function reaches the branch that waves an
-- FK orphan through.
create or replace function public.refuse_orphaning_a_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Detaching a withdrawal from a holding that is STILL THERE is a different act
  -- with a different message, and enforce_withdrawal_within_balance already owns
  -- it. Only the FK's own orphaning reaches past here.
  if exists (select 1 from public.investment_transactions t
              where t.transaction_id = old.parent_transaction_id) then
    return new;
  end if;

  -- The source was deleted while this row still draws on it. #608 refuses the
  -- shrinking edit; deleting is that edit taken all the way, so it is refused the
  -- same way rather than left to orphan the claim in silence (#607). This is the
  -- only moment it can be caught — at commit the FK has already erased which
  -- holding the row drew on.
  --
  -- Three carve-outs, each a shape where nothing is left owing:
  --   • the account cascade — the whole ledger is going, and the auth.users row is
  --     already invisible by the time this FK action fires, exactly as the deleted
  --     parent above is. Without this, an account with any sell in it could not be
  --     deleted at all.
  --   • a fund-keyed sell — it draws on its (goal, fund) bucket whatever it names
  --     as a parent, so the parent leaving costs it nothing.
  --   • a held-for-merge settlement — 20260731000001 owns that case and answers it
  --     with something the user can act on ("remove the settlement first"); firing
  --     here first would replace that with a vaguer sentence about a balance.
  if (coalesce(new.principal_withdrawn, 0) > 0 or coalesce(new.units_withdrawn, 0) > 0)
     and not new.held_for_merge
     and not coalesce(new.asset_type = 'fund' and new.fund_id is not null, false)
     and exists (select 1 from auth.users u where u.id = old.user_id) then
    raise exception 'withdrawal invariant: holding % cannot be deleted while this withdrawal still draws % on it',
      old.parent_transaction_id, coalesce(new.principal_withdrawn, 0)
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.refuse_orphaning_a_claim() is
  'Refuses deleting a holding that a withdrawal still draws on, caught as the FK orphans the child because that is the last moment the link is readable (#607, #608).';

revoke all on function public.refuse_orphaning_a_claim() from public, anon, authenticated;

drop trigger if exists investment_transactions_source_not_deletable on public.investment_transactions;
create trigger investment_transactions_source_not_deletable
  before update of parent_transaction_id on public.investment_transactions
  for each row
  when (old.transaction_type = 'withdrawal'
        and old.parent_transaction_id is not null
        and new.parent_transaction_id is null)
  execute function public.refuse_orphaning_a_claim();
