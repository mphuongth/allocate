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

-- ─── Why the bucket check takes a lock ───────────────────────────────────────
--
-- check_fund_bucket_solvent reads its two sums unlocked, which was enough while a
-- relocation was the only thing that called it. Measuring EDITS through it opens
-- an interleaving nothing serializes: two transactions shrinking DIFFERENT
-- purchases of one bucket each lock only their own row, each reads the other at
-- its old size, and both pass. Verified against the local stack — two 50-unit
-- purchases and a 60-unit sale, each purchase edited to 20 in a concurrent
-- session: both committed, 40 units left backing 60, no error.
--
-- The row lock the withdrawal side uses (SELECT ... FOR UPDATE over the bucket in
-- transaction_id order) cannot be reused here. It works there because the sale
-- takes every lock itself, in one order; an EDIT already holds the lock on the row
-- it is changing before any check runs, so two edits enter with locks held in
-- opposite orders and would deadlock instead of serialising.
--
-- So the bucket takes ONE lock, on the bucket itself, keyed by (user, fund, goal)
-- — a transaction-scoped advisory lock, released at commit like any other. The
-- loser waits, and its next statement then reads a fresh snapshot containing the
-- winner's committed edit, which is exactly the balance it should be measured
-- against. Edits against SALES need nothing new: a sale locks the purchase rows,
-- an edit holds one of them, so those two already serialise.
--
-- A hash collision costs a wait between two unrelated buckets and nothing else.
-- A statement that touches two buckets (a relocation measures both ends) takes two
-- of these locks, so two simultaneous and opposite relocations of one fund can
-- still deadlock; Postgres aborts one of them, and the invariant holds either way.
--
-- WAITING FOR THE LOCK IS NOT ENOUGH ON ITS OWN, and the reason is the isolation
-- level. Under READ COMMITTED the loser's next statement takes a fresh snapshot, so
-- it measures the winner's committed edit and refuses — that is the whole mechanism.
-- Under REPEATABLE READ the snapshot is frozen at the first statement, so the loser
-- waits, reads its own stale view, and passes: verified, the two-purchase scenario
-- above still ends at 40 units backing 60. So the lock is TRIED rather than waited
-- for, and a contended bucket outside READ COMMITTED is answered with a
-- serialization failure — the class such a caller is already written to retry, and
-- the retry gets the fresh snapshot it needs. Nothing changes under READ COMMITTED,
-- which is what PostgREST and every RPC here run at, and what 20260730000002's own
-- header reasons in.
--
-- One gap remains, stated rather than papered over: a REPEATABLE READ transaction
-- whose snapshot predates a bucket edit that COMMITTED before this check runs sees
-- no contention to detect and measures the stale view. Closing that needs a fresh
-- read inside a frozen transaction, which is not something a trigger can do. No
-- writer in this codebase runs at that level.
-- Re-issued rather than wrapped: the arithmetic below is verbatim from
-- 20260803000004 and stays the only copy, with the lock taken ahead of it.
create or replace function public.check_fund_bucket_solvent(p_user uuid, p_fund uuid, p_goal uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_units      numeric;
  v_out_units  numeric;
  v_basis      bigint;
  v_out_basis  bigint;
  v_par_units  numeric;
  v_par_basis  bigint;
  v_key        bigint;
  -- One đồng per sale, for the reason the parent axis needs it: the proportional
  -- allocation is checked per sale with no running total and no carve-out once the
  -- remaining basis rounds to nothing, so a 1 đồng / 5 unit purchase legally
  -- carries three 1-đồng sales. A flat đồng refused every later edit of such a
  -- bucket, including one that only GREW the purchase. Units stay flat: that bound
  -- withholds its epsilon at zero, so it cannot accumulate.
  v_sales      int;
  v_par_count  int;
begin
  v_key := pg_catalog.hashtextextended(
    p_user::text || ':' || p_fund::text || ':' || coalesce(p_goal::text, ''), 0);
  if not pg_catalog.pg_try_advisory_xact_lock(v_key) then
    -- Someone else is measuring this bucket. Waiting only helps if the sums below
    -- will then be read fresh, which is a READ COMMITTED promise (see the header).
    if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
      raise exception 'withdrawal invariant: this fund bucket is being edited concurrently and cannot be measured against a frozen snapshot — retry the transaction'
        using errcode = 'serialization_failure';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(v_key);
  end if;

  select coalesce(sum(t.units), 0), coalesce(sum(t.amount_vnd), 0)
    into v_units, v_basis
    from public.investment_transactions t
   where t.user_id = p_user and t.fund_id = p_fund and t.asset_type = 'fund'
     and t.transaction_type = 'investment'
     and t.goal_id is not distinct from p_goal
     and t.renewed_from_transaction_id is null
     and t.units is not null;

  select coalesce(sum(w.units_withdrawn), 0), coalesce(sum(w.principal_withdrawn), 0), count(*)
    into v_out_units, v_out_basis, v_sales
    from public.investment_transactions w
   where w.user_id = p_user and w.fund_id = p_fund and w.asset_type = 'fund'
     and w.transaction_type = 'withdrawal'
     and w.goal_id is not distinct from p_goal;

  -- The legacy claims, priced the way the reader prices them: recorded units when
  -- there are any, the capped pro-rata share of the named purchase when there are
  -- not. Keyed by the PURCHASE's goal, because that is the bucket it draws on.
  select coalesce(sum(case when coalesce(w.units_withdrawn, 0) > 0 then w.units_withdrawn
                           else least(p.units, p.units * coalesce(w.principal_withdrawn, 0) / p.amount_vnd)
                      end), 0),
         coalesce(sum(coalesce(w.principal_withdrawn, 0)), 0), count(*)
    into v_par_units, v_par_basis, v_par_count
    from public.investment_transactions w
    join public.investment_transactions p
      on p.transaction_id = w.parent_transaction_id
   where w.user_id = p_user
     and w.transaction_type = 'withdrawal'
     and (w.asset_type is distinct from 'fund' or w.fund_id is null)
     and p.transaction_type = 'investment'
     and p.asset_type = 'fund'
     and p.fund_id = p_fund
     and p.goal_id is not distinct from p_goal
     and coalesce(p.units, 0) > 0
     and coalesce(p.amount_vnd, 0) > 0;

  v_out_units := v_out_units + v_par_units;
  v_out_basis := v_out_basis + v_par_basis;
  -- Deliberately NOT gated on the bucket still holding something, unlike the
  -- parent axis. The flat đồng this replaces was ungated too, and a purchase-less
  -- bucket is a real state a relocation can leave (#587) — withdrawal_ledger_audit
  -- has a fixture standing on exactly that tolerance, and REPORTS such a bucket
  -- rather than having the invariant refuse it. This change makes the allowance
  -- per sale instead of flat; tightening the empty case is a different decision
  -- and not this issue's to take. The units bound still catches what matters:
  -- emptying a bucket that has sold units is refused there whatever the basis says.
  v_sales     := v_sales + v_par_count;

  if v_out_units > v_units + 0.0001 or v_out_basis > v_basis + v_sales then
    raise exception 'withdrawal invariant: this fund bucket would be left owing % units / % of basis it does not hold',
      v_out_units - v_units, v_out_basis - v_basis using errcode = 'check_violation';
  end if;
end;
$$;

comment on function public.check_fund_bucket_solvent(uuid, uuid, uuid) is
  'Raises when a (goal, fund) bucket would be left owing more units or basis than its purchases hold, under a lock on the bucket so two concurrent edits of it cannot both pass (#587, #606, #608).';

revoke all on function public.check_fund_bucket_solvent(uuid, uuid, uuid) from public;
revoke all on function public.check_fund_bucket_solvent(uuid, uuid, uuid) from anon, authenticated;

-- ── the measurement ─────────────────────────────────────────────────────────
create or replace function public.check_source_backs_claims(src public.investment_transactions)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- ── how much rounding this side must forgive, and no more ────────────────
  --
  -- The withdrawal side's tolerances are per sale, and whether they ACCUMULATE
  -- across a ledger turns on one detail that differs between the two: what happens
  -- when the holding runs out. Getting it wrong is over-permissive one way and
  -- makes legal ledgers uneditable the other, and this file has now been wrong in
  -- both directions.
  --
  -- UNITS do not accumulate. The bound is `v_left_units + (case when v_left_units >
  -- 0 then ε else 0)` — the epsilon is WITHHELD at zero, so it never rounds an
  -- empty holding upward. Each sale is measured against what earlier sales left,
  -- so u₂ ≤ (held − u₁) + ε gives u₁ + u₂ ≤ held + ε whatever the count. Counting
  -- them let a 10-unit sold gold holding be restated at 9.99985.
  --
  -- PRINCIPAL does accumulate, and only for gold. The proportional branch has no
  -- running total at all — it checks `abs(principal − round(share)) ≤ 1`, with no
  -- carve-out at zero. So when the remaining basis rounds to nothing every further
  -- sale may still take its đồng: the audit suite's own legal fixture is a 1 đồng /
  -- 5 chỉ holding sold in three 1-unit slices, three đồng out of one, every write
  -- accepted (withdrawal_ledger_audit.test.sql — "'Σ principal ≤ basis' was never
  -- the invariant's rule for gold"). A flat đồng made that holding uneditable: even
  -- GROWING its units was refused. So the principal allowance is one đồng per
  -- quantity-valued sale.
  --
  -- And gold ALONE. check_withdrawal_balance caps bank and stock outright at
  -- `principal_withdrawn > v_left`, so their claims can never sum past the holding
  -- and slack there forgives no rounding — it is a đồng of real overdraw. A 100
  -- stock holding with an 80 withdrawal was editable down to 79, which the
  -- dashboard values at minus one.
  --
  -- Both round a REAL balance and never create one: applied to a holding emptied to
  -- nothing they would hand it slack it never had, the same carve-out the units
  -- bound above makes for itself.
  c_units_epsilon constant numeric := 0.0001;
  v_priced        int;
  v_allow         bigint  := 0;
  v_allow_units   numeric := 0;
  v_out_principal bigint;
  v_out_units     numeric;
  v_have          bigint;
  v_have_units    numeric;
begin
  -- A fund purchase IS its bucket, and the bucket is what claims draw on. `units
  -- > 0` mirrors lib/withdrawalProgress exactly: a purchase with none is no
  -- bucket — the dashboard values it as an ordinary holding — so it falls through
  -- to the parent axis below, where its claims actually sit. A renewal snapshot is
  -- history rather than a holding, and check_fund_bucket_solvent leaves it out of
  -- the sums for that reason, so it is not this bucket either.
  if src.transaction_type = 'investment' and src.asset_type = 'fund'
     and src.fund_id is not null and coalesce(src.units, 0) > 0
     and src.renewed_from_transaction_id is null then
    perform public.check_fund_bucket_solvent(src.user_id, src.fund_id, src.goal_id);
    return;
  end if;

  -- What is drawn on this row, summed the way check_withdrawal_balance's parent
  -- branch sums it — a fund-keyed sibling draws on its own bucket whatever it
  -- names as a parent, so counting it here would charge it twice.
  select coalesce(sum(w.principal_withdrawn), 0), coalesce(sum(w.units_withdrawn), 0),
         count(*) filter (where coalesce(w.units_withdrawn, 0) > 0)
    into v_out_principal, v_out_units, v_priced
    from public.investment_transactions w
   where w.parent_transaction_id = src.transaction_id
     and w.transaction_type = 'withdrawal'
     and not coalesce(w.asset_type = 'fund' and w.fund_id is not null, false);

  if v_out_principal = 0 and v_out_units = 0 then return; end if;

  -- A row that is no longer an investment holds nothing at all: the dashboard
  -- values no balance for it, so every claim parented to it is unbacked. That is
  -- the same hole reached through transaction_type instead of amount_vnd, which
  -- is why the trigger watches that column too.
  -- A fund row with NULL units is the same statement in the dashboard's own words:
  -- lib/dashboardOverview drops it from `investments` outright (the pending-DCA
  -- exclusion), so it is valued at nothing whatever its amount_vnd says. Nulling
  -- the units of a purchase carrying a legacy parented claim therefore took BOTH
  -- out of the dashboard at once — no overdraw to find, because the holding and its
  -- claim vanished together, which is worse than the overdraw this file exists to
  -- refuse. `units = 0` is NOT this case: that row is still valued, just as an
  -- ordinary holding rather than a fund bucket.
  -- And a row stamped as renewal HISTORY is out of active_investment_transactions
  -- altogether, so the dashboard has no holding left for these claims to apply to.
  -- Stamping a live 100,000,000 deposit carrying a 60,000,000 withdrawal took both
  -- out of the totals at once — the fund half of this was already refused through
  -- the bucket, this is the same act on the parent axis.
  if src.transaction_type is distinct from 'investment'
     or src.renewed_from_transaction_id is not null
     or (src.asset_type = 'fund' and src.units is null) then
    v_have       := 0;
    v_have_units := 0;
  else
    v_have       := coalesce(src.amount_vnd, 0);
    v_have_units := coalesce(src.units, 0);
  end if;

  if v_have > 0 and src.asset_type = 'gold' then v_allow := v_priced; end if;
  if v_have_units > 0 then v_allow_units := c_units_epsilon; end if;

  -- The balances the messages report are the REAL ones, not the allowance-inflated
  -- figures the comparison uses: "a balance of 101" for a 100 đồng holding sends
  -- the reader looking for a đồng that was never there.
  if v_out_principal > v_have + v_allow then
    raise exception 'withdrawal invariant: holding % would be left owing % it does not hold (% withdrawn against a balance of %)',
      src.transaction_id, v_out_principal - v_have, v_out_principal, v_have
      using errcode = 'check_violation';
  end if;

  if v_out_units > v_have_units + v_allow_units then
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

  -- A row that was ALREADY history before this statement is not something this
  -- edit took away, and the renewal RPCs write exactly that shape on purpose: the
  -- snapshot is inserted as history and partial withdrawals are re-parented onto it
  -- (#585), which is how a renewed deposit stops double-counting them. Those claims
  -- are inert by design — the snapshot is not an active holding — so measuring them
  -- against it would refuse the renewal itself. What is measured is a LIVE holding
  -- becoming history, which is a balance leaving.
  if old.renewed_from_transaction_id is null then
    perform public.check_source_backs_claims(v_row);
  end if;

  -- A purchase that LEFT a bucket — its fund cleared, its asset_type changed, its
  -- goal moved — shrinks the bucket it came from by everything it held, and the
  -- row above no longer knows anything about that bucket. Measure the old one too.
  -- Deleting the fund itself needs no exemption here: it clears fund_id on the
  -- purchases and the sells alike, so the old bucket is empty on both sides and
  -- the check is 0 against 0.
  --
  -- Stated as "was a bucket, and is not still THAT bucket" rather than as a list
  -- of the columns that can move it. As a list it missed the quietest way out:
  -- clearing `units` alone. The PUT route accepts both 0 and null there, and
  -- neither the fund, the asset type, the goal nor the transaction type changes —
  -- so a 100-unit purchase backing a 60-unit sale was emptied and committed, the
  -- dashboard dropped the purchase (it keys a fund holding on `units`), and the
  -- sale stayed. The row itself is measured on the parent axis by then, where a
  -- fund-keyed sell does not appear at all, so nothing else was going to catch it.
  --
  -- renewed_from_transaction_id is the second one, and it leaves no trace at all:
  -- stamping it on a LIVE purchase files it as history, which every reader and
  -- check_fund_bucket_solvent alike exclude from the sums. A 100-unit purchase
  -- backing a 60-unit sale left a bucket the reader counts as 0 units against 60.
  -- Watched in the trigger's `update of` list for the same reason.
  if old.transaction_type = 'investment' and old.asset_type = 'fund'
     and old.fund_id is not null and coalesce(old.units, 0) > 0
     and old.renewed_from_transaction_id is null
     and not (new.transaction_type = 'investment' and new.asset_type = 'fund'
              and new.fund_id is not distinct from old.fund_id
              and new.goal_id is not distinct from old.goal_id
              and coalesce(new.units, 0) > 0
              and new.renewed_from_transaction_id is null) then
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
  -- Every column that can change what this row CONTRIBUTES to a balance, which
  -- includes renewed_from_transaction_id: stamping it files a live purchase as
  -- history, and history is left out of the bucket sums.
  after update of transaction_type, asset_type, amount_vnd, units, fund_id, goal_id,
                  renewed_from_transaction_id
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
  -- A renewal snapshot was never in the bucket's sums, so removing one cannot
  -- leave it short.
  when (old.transaction_type = 'investment' and old.asset_type = 'fund'
        and old.fund_id is not null and coalesce(old.units, 0) > 0
        and old.renewed_from_transaction_id is null)
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
