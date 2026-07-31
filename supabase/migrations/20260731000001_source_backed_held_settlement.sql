-- Make a held-for-merge settlement source-backed and atomic (#588).
--
-- A held settlement ("Để dành gộp") is a withdrawal row that CLOSES a maturing
-- deposit while parking its cash for a later merge. The dashboard synthesizes
-- that parked cash straight back into net worth and the goal bar
-- (lib/heldForMerge → overview: totalAssets += amount, progressValue += amount),
-- because the deposit it closed has stopped counting.
--
-- The route built that row from the client's body: it required a target goal and
-- nothing else. Two holes followed, both reproduced against a live database:
--
--   1. NO SOURCE AT ALL. The withdrawal invariant (#587/#599) refuses any
--      withdrawal that draws on no holding — except a held one, deliberately,
--      because this shape had no source to name yet. So an insert with
--      held_for_merge = true, no parent_transaction_id, amount_vnd = 999,000,000
--      was accepted, while the identical row without the flag was refused. That
--      amount went straight into total assets and goal progress, backed by
--      nothing.
--   2. AMOUNT UNBOUNDED EVEN WITH A SOURCE. The invariant bounds
--      principal_withdrawn and units_withdrawn against the holding's remaining
--      balance. It never looks at the withdrawal row's own amount_vnd — and
--      amount_vnd is precisely the number that becomes net worth. A settlement
--      of a 1,000,000 deposit could carry amount_vnd = 999,000,000.
--
-- Both are self-inflicted (RLS still confines a caller to their own rows), but
-- they misstate net worth, invested value and goal progress, which is what this
-- app is for.
--
-- The fix is one RPC that derives everything derivable from the SOURCE rather
-- than trusting the caller, and a CHECK that keeps the shape from being written
-- any other way.

-- ─── what counts as a settleable deposit ─────────────────────────────────────
--
-- One definition, called by BOTH writers: the RPC (so a caller gets the refusal
-- before any work happens) and the row trigger below (so a raw INSERT/UPDATE
-- meets the same bar). They used to state these rules separately, and the trigger
-- checked only the amount — so a direct writer could settle a RENEWAL SNAPSHOT,
-- which the dashboard excludes from active investments: closing it removed
-- nothing from net worth while the pool added the settlement beside it, worth up
-- to ten times a deposit that had already been closed. Two statements of one rule
-- is how that gap opened, so there is now one.
--
-- Returns the source's remaining principal. p_exclude_tx leaves a row out of the
-- already-withdrawn sum — the settlement being written — so the answer reads the
-- same on the insert that creates it and on a later update to it.
--
-- security INVOKER, deliberately. It is called from two places with different
-- privileges and that is exactly what makes invoker right:
--
--   • from the trigger, which is security definer — so inside it the current user
--     is the owner, RLS does not apply, and every writer's row gets measured
--     including one whose source RLS would hide from the caller;
--   • from the RPC, which is security invoker — so it reads as the caller, under
--     RLS, after the RPC has already proved the source is visible to them.
--
-- Definer here would have been wrong twice over: it would let a caller probe
-- another user's transaction ids for eligibility, and revoking EXECUTE to prevent
-- that would block the RPC itself (it runs as the caller) — which is exactly the
-- 500 that mistake produced.
drop function if exists public.held_settlement_source_state(uuid, uuid);

create or replace function public.held_settlement_source_state(
  p_source_id uuid,
  p_exclude_tx uuid default null
)
returns table (remaining bigint, source_goal_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_src public.investment_transactions;
  v_eff bigint;
begin
  if p_source_id is null then
    raise exception 'held settlement: name the deposit this settles'
      using errcode = 'check_violation';
  end if;

  select * into v_src
    from public.investment_transactions
   where transaction_id = p_source_id;
  if not found then
    raise exception 'held settlement: the deposit being settled was not found'
      using errcode = 'no_data_found';
  end if;

  -- Eligibility, mirroring the merge RPC's ruleset for a live source
  -- (20260620000006): a plain, ACTIVE, single bank term deposit. A withdrawal has
  -- nothing to close; a fund/gold holding is not settled this way; an accumulating
  -- book spans tranches this one row could not close; a renewal snapshot is a
  -- closed cycle that no longer counts in net worth, so settling it would add cash
  -- without removing anything.
  if v_src.transaction_type is distinct from 'investment' then
    raise exception 'held settlement: the source must be a deposit, not a withdrawal'
      using errcode = 'check_violation';
  end if;
  if v_src.asset_type is distinct from 'bank' then
    raise exception 'held settlement: only a bank deposit can be settled for merge'
      using errcode = 'check_violation';
  end if;
  if v_src.deposit_group_id is not null then
    raise exception 'held settlement: an accumulating book cannot be settled for merge yet'
      using errcode = 'check_violation';
  end if;
  if v_src.renewed_from_transaction_id is not null then
    raise exception 'held settlement: a renewal snapshot is already closed'
      using errcode = 'check_violation';
  end if;
  -- Pledged means frozen as collateral. The sheet already refuses to offer a
  -- pledged deposit for merge (lib/mergeEligibility), so the server saying the
  -- same thing closes the raw-API path rather than adding a new rule.
  if coalesce(v_src.is_pledged, false) then
    raise exception 'held settlement: a pledged deposit is frozen as collateral'
      using errcode = 'check_violation';
  end if;

  select v_src.amount_vnd - coalesce(sum(w.principal_withdrawn), 0)
    into v_eff
    from public.investment_transactions w
   where w.parent_transaction_id = p_source_id
     and w.transaction_type = 'withdrawal'
     and (p_exclude_tx is null or w.transaction_id <> p_exclude_tx);

  if v_eff <= 0 then
    raise exception 'held settlement: this deposit has already been fully withdrawn'
      using errcode = 'check_violation';
  end if;

  -- The goal comes back with the balance because the two are asked together by
  -- both callers: a settlement belongs to the goal its deposit is in.
  remaining := v_eff;
  source_goal_id := v_src.goal_id;
  return next;
end;
$$;

grant execute on function public.held_settlement_source_state(uuid, uuid) to authenticated;

-- ─── create_held_settlement ──────────────────────────────────────────────────
--
-- The caller supplies the source, what was received, and where the cash is
-- earmarked. Everything else — owner, goal, asset type, direction, and
-- principal_withdrawn — is read off the source.
--
-- security invoker, so RLS is the ownership check: a source belonging to someone
-- else is simply not visible and the lookup reports "not found". Every later
-- comparison is then row-to-row against v_src.user_id, which also holds for a
-- service-role caller where there is no auth.uid() to compare against (the same
-- reasoning as the #474/#525 ownership triggers).
--
-- The FOR UPDATE is what makes two settlements of one deposit impossible. The
-- lock is taken BEFORE the remaining-principal aggregate is read, so a second
-- settlement blocks until the first commits, then re-reads the sum, sees the
-- withdrawal the first one inserted, and finds nothing left to close.
--
-- The recurring unlink is NOT repeated here: clear_recurring_link_on_hold
-- (20260727000003, #531) already fires AFTER INSERT on exactly this shape, and
-- an AFTER trigger runs inside the insert's own transaction. Doing it twice
-- would be the same update run twice, not a stronger guarantee.
create or replace function public.create_held_settlement(
  p_source_id uuid,
  p_amount_vnd bigint,
  p_investment_date date default null,
  p_merge_target_goal_id uuid default null,
  p_merge_anchor_inv_id uuid default null
)
returns public.investment_transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- Same ×10 sanity bound the multi-source merge already applies to a client's
  -- "received" (20260620000006). Settling a deposit releases its remaining
  -- principal plus interest, never a multiple of it. Deriving an exact cap would
  -- mean reimplementing lib/depositValuation's accrual in SQL and keeping the two
  -- in step forever; a bound generous enough never to refuse a real
  -- held-to-maturity value, but tight enough that the number cannot be invented,
  -- is the trade the merge path already made. Same rule in both places.
  v_src    public.investment_transactions;
  v_eff    bigint;
  v_target uuid;
  v_row    public.investment_transactions;
begin
  if p_amount_vnd is null or p_amount_vnd <= 0 then
    raise exception 'held settlement: the amount received must be positive'
      using errcode = 'check_violation';
  end if;
  if p_source_id is null then
    raise exception 'held settlement: name the deposit this settles'
      using errcode = 'check_violation';
  end if;

  -- The lock is taken by THIS function rather than by the shared check: it is what
  -- makes two settlements of one deposit impossible, and taking it under RLS is
  -- also the ownership boundary — a source belonging to someone else is not
  -- visible here at all.
  select * into v_src
    from public.investment_transactions
   where transaction_id = p_source_id
   for update;
  if not found then
    raise exception 'held settlement: the deposit being settled was not found'
      using errcode = 'no_data_found';
  end if;

  -- Eligibility and the remaining principal come from the one definition every
  -- writer answers to. The amount bound is NOT checked here — the row trigger owns
  -- it, so there is one comparison rather than two that can drift.
  select remaining into v_eff from public.held_settlement_source_state(p_source_id);

  -- Net-worth safety. Closing the deposit removes it from net worth, and the
  -- pool adds the cash back ONLY through merge_target_goal_id. Unresolvable
  -- means the money leaves and is surfaced nowhere — so refuse rather than
  -- mis-state total assets. Defaulting to the source's own goal is what the app
  -- means by "stays where the deposit was".
  v_target := coalesce(p_merge_target_goal_id, v_src.goal_id);
  if v_target is null then
    raise exception 'held settlement: needs a target goal, or the parked cash leaves net worth with nothing to add it back to'
      using errcode = 'check_violation';
  end if;
  -- merge_target_goal_id is an app-managed mirror with no FK (20260620000004),
  -- so ownership is checked here rather than by a constraint.
  --
  -- insufficient_privilege, not check_violation: this is the #474/#525 rule that
  -- a caller may not point at another user's row, and the route turns it into the
  -- 403 every other cross-user reference in the API answers with. A malformed
  -- request and a forbidden one are different answers.
  perform 1 from public.savings_goals
   where goal_id = v_target and user_id = v_src.user_id;
  if not found then
    raise exception 'held settlement: the target goal does not belong to this deposit'
      using errcode = 'insufficient_privilege';
  end if;
  -- The two goal columns must agree, because two different readers use two
  -- different ones: the dashboard shows the parked cash under
  -- merge_target_goal_id, while renew_term_deposit_with_merge will only let a
  -- deposit consume a held row whose goal_id matches its own. Let them diverge
  -- and the settlement is displayed in one goal and consumable only from
  -- another — visible, and impossible to act on where it is visible.
  --
  -- So a settlement does not move cash between goals: an explicit target may
  -- only name the goal the deposit is already in. The one case where the target
  -- genuinely decides is a deposit with NO goal, where there is nothing to
  -- disagree with — and the row then takes the target as its own goal_id so both
  -- readers still agree.
  if v_src.goal_id is not null and v_target is distinct from v_src.goal_id then
    raise exception 'held settlement: the cash stays in the deposit''s own goal — it cannot be earmarked to a different one'
      using errcode = 'check_violation';
  end if;

  if p_merge_anchor_inv_id is not null then
    if p_merge_anchor_inv_id = p_source_id then
      raise exception 'held settlement: a deposit cannot wait to be merged into itself'
        using errcode = 'check_violation';
    end if;
    perform 1 from public.investment_transactions
     where transaction_id = p_merge_anchor_inv_id and user_id = v_src.user_id;
    if not found then
      raise exception 'held settlement: the anchor deposit does not belong to this deposit'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- "Để dành gộp" closes the deposit outright, so principal_withdrawn is the
  -- whole remaining principal — derived, never the client's number. The
  -- withdrawal invariant re-checks it against the same balance on the way in.
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
    investment_date, amount_vnd, principal_withdrawn, affects_progress,
    held_for_merge, merge_target_goal_id, merge_anchor_inv_id
  ) values (
    -- goal_id = v_target, not v_src.goal_id: they are equal whenever the source
    -- has a goal (checked above), and when it has none this is what keeps the
    -- row's goal and its display goal the same.
    v_src.user_id, v_target, 'bank', 'withdrawal', p_source_id,
    coalesce(p_investment_date, current_date), p_amount_vnd, v_eff, true,
    true, v_target, p_merge_anchor_inv_id
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_held_settlement(uuid, bigint, date, uuid, uuid) to authenticated;

-- ─── the amount, as an invariant ─────────────────────────────────────────────
--
-- Routing the app through the RPC is not the same as making the RPC the only
-- writer. An authenticated caller can still write investment_transactions
-- directly — RLS confines them to their own rows, and their own rows are exactly
-- what this is about. Two writes get past a shape-only constraint:
--
--   • an INSERT with a real parent and a correct principal_withdrawn, but
--     amount_vnd = 999,000,000 (the withdrawal invariant bounds the principal,
--     never the row's own amount); and
--   • an UPDATE that raises amount_vnd on a settlement that was created properly.
--
-- Both put a number the deposit cannot back straight into total assets. The bound
-- therefore has to live where every writer meets it. A CHECK cannot express it —
-- it has to read the source row — so this is a trigger, the same shape the
-- withdrawal invariant takes (20260730000002), and it carries the same ×10 rule
-- the RPC applies so there is one bound rather than two that can drift.
create or replace function public.check_held_amount_within_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The same ×10 sanity bound the multi-source merge applies to a client's
  -- "received" (20260620000006). Settling a deposit releases its remaining
  -- principal plus interest, never a multiple of it. An exact cap would mean
  -- reimplementing lib/depositValuation's accrual in SQL and keeping the two in
  -- step forever; a bound generous enough never to refuse a real held-to-maturity
  -- value, but tight enough that the number cannot be invented, is the trade the
  -- merge path already made. Same rule in both places, and now only one copy.
  c_amount_factor constant int := 10;
  v_eff       bigint;
  v_src_goal  uuid;
begin
  -- A legacy held row predating these guards may have no parent. It cannot be
  -- measured, and refusing every unrelated update to it would be a second,
  -- unannounced migration; the deferred source check is what stops NEW ones.
  if new.parent_transaction_id is null then return new; end if;

  -- Eligibility AND the remaining principal, from the definition the RPC uses.
  -- Checking the amount without checking the source is what let a raw write settle
  -- a renewal snapshot — a deposit already excluded from net worth, so the pool's
  -- cash was added with nothing removed to balance it.
  select remaining, source_goal_id
    into v_eff, v_src_goal
    from public.held_settlement_source_state(new.parent_transaction_id, new.transaction_id);

  -- A settlement belongs to the goal its deposit is in. The shape constraint only
  -- makes the row's two goal columns agree WITH EACH OTHER — a raw write could set
  -- both to another owned goal, closing goal A's deposit and showing its cash in
  -- goal B, which is exactly the cross-goal transfer the RPC refuses. An
  -- unassigned deposit is the intended exception: there is nothing to disagree
  -- with, so the settlement's goal is what decides.
  if v_src_goal is not null and new.goal_id is distinct from v_src_goal then
    raise exception 'held settlement: the cash stays in the deposit''s own goal — it cannot be filed under a different one'
      using errcode = 'check_violation';
  end if;

  -- affects_progress = false takes the withdrawal out of the goal bar's
  -- withdrawal map, so the bar keeps counting the deposit — while
  -- heldForMergeContributions adds the parked cash to progressValue regardless.
  -- The bar would then count both. The RPC always writes true; so must everyone.
  if new.affects_progress is distinct from true then
    raise exception 'held settlement: must affect goal progress — it closes the deposit the bar is counting'
      using errcode = 'check_violation';
  end if;


  -- Full closure. "Để dành gộp" settles the deposit outright — that is what
  -- licenses the pool to add the cash back, because the deposit has stopped
  -- counting. Bounding the amount alone is not enough: a raw write could take
  -- principal_withdrawn = 1 against a 1,000,000 deposit and still claim
  -- amount_vnd = 10,000,000, leaving the deposit worth 999,999 in net worth while
  -- the pool adds ten million beside it.
  if coalesce(new.principal_withdrawn, 0) <> v_eff then
    raise exception 'held settlement: must close the whole deposit — % left, but % taken', v_eff, coalesce(new.principal_withdrawn, 0)
      using errcode = 'check_violation';
  end if;

  if new.amount_vnd > v_eff * c_amount_factor then
    raise exception 'held settlement: % is unreasonably large for a deposit with % left', new.amount_vnd, v_eff
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.check_held_amount_within_source() from public, anon, authenticated;

drop trigger if exists investment_transactions_held_amount_bound on public.investment_transactions;
-- Every UPDATE of a held row, not a list of columns.
--
-- It WAS a list — amount_vnd, held_for_merge, parent_transaction_id,
-- principal_withdrawn — written when the bound was the only rule here. Each rule
-- added since (full closure, the parent's goal, affects_progress) reads a column
-- the list did not name, so an UPDATE touching only that column skipped the check
-- entirely: `set affects_progress = false` on a perfectly valid settlement went
-- straight through, and so did moving both goal columns to another owned goal.
--
-- A list has to be re-derived every time a rule is added, and forgetting is
-- silent. Firing on every update of a held row cannot be forgotten. The cost is a
-- re-validation on writes that were already valid — held rows are few, and the
-- merge consume's own update re-proves the same invariants rather than skipping
-- them, which is the behaviour worth having anyway.
create trigger investment_transactions_held_amount_bound
  before insert or update
  on public.investment_transactions
  for each row
  when (new.held_for_merge)
  execute function public.check_held_amount_within_source();

-- ─── editing a deposit that has already been settled ─────────────────────────
--
-- Every guard above measures the SETTLEMENT. None of them fires when the SOURCE
-- is edited, because the source is not a held row — and the settlement's whole
-- meaning is a statement ABOUT the source's balance:
--
--   a 1,000,000 deposit is settled (the settlement closes all 1,000,000), then
--   the deposit is edited to 100,000,000 → 99,000,000 of it is active again in
--   net worth while its cash is still sitting in the pool. Counted twice.
--
-- goal_id is here for the same reason: the settlement is filed under its
-- deposit's goal, so moving the deposit afterwards would split the two apart —
-- the cash shown in one goal, consumable only from another.
--
-- Refusing is the answer rather than cascading a correction: the settlement is a
-- record of what was closed, and silently rewriting it to match a new number
-- would restate history the user did not ask to restate. The remedy is the one
-- the UI already offers — "Bỏ chờ gộp" removes the settlement and restores the
-- deposit, after which it edits freely.
create or replace function public.guard_settled_source_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
    from public.investment_transactions s
   where s.parent_transaction_id = old.transaction_id
     and s.held_for_merge
   limit 1;
  if found then
    raise exception 'held settlement: this deposit has a settlement recorded against it — remove that settlement before changing its amount or goal'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_settled_source_edit() from public, anon, authenticated;

drop trigger if exists investment_transactions_guard_settled_source on public.investment_transactions;
create trigger investment_transactions_guard_settled_source
  before update of amount_vnd, goal_id on public.investment_transactions
  for each row
  when (new.amount_vnd is distinct from old.amount_vnd
        or new.goal_id is distinct from old.goal_id)
  execute function public.guard_settled_source_edit();

-- ─── the source requirement, deferred ────────────────────────────────────────
--
-- "A held settlement names the deposit it closed" cannot be an ordinary CHECK,
-- because parent_transaction_id is ON DELETE SET NULL: removing a settled deposit
-- nulls its settlement's parent, and an immediate check refuses that referential
-- update — turning an ordinary ledger action into a constraint violation the
-- DELETE route reports as 500.
--
-- Two earlier attempts got this wrong, both worth recording so they are not
-- tried again:
--
--   • a BEFORE DELETE guard on the source. It fires per row, so it also aborted
--     statements that remove the settlement TOO — `delete from auth.users`
--     (user_id cascades over every transaction) and service-role bulk cleanup.
--     Nothing survives those, so there is no invariant left to protect, and
--     refusing them broke account deletion outright.
--   • making the FOREIGN KEY deferrable. Referential ACTIONS are not deferred by
--     that — only the check is — so the SET NULL still fired immediately. It
--     appeared to work only because a single bulk DELETE sometimes processes the
--     settlement before the deposit, which is not an ordering anything may rely on.
--
-- What actually separates the two cases is asking the question at the END of the
-- transaction: does a settlement still exist with no deposit behind it? A
-- DEFERRABLE INITIALLY DEFERRED constraint trigger asks exactly that, and CHECK
-- constraints cannot be deferred, which is why this is a trigger.
--
--   • both rows go — at commit the settlement is gone, the re-read finds
--     nothing, and the transaction stands;
--   • only the deposit goes — at commit the settlement is still there with a
--     null parent, and it is refused.
--
-- The re-read is the whole mechanism: the trigger was queued against a row that
-- may since have been deleted, so it must look at the table as it will be
-- committed, not at the NEW image it was handed.
create or replace function public.check_held_settlement_has_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
    from public.investment_transactions t
   where t.transaction_id = new.transaction_id
     and t.held_for_merge
     and t.parent_transaction_id is null;
  if found then
    raise exception 'held settlement: a settlement must name the deposit it closed'
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

revoke all on function public.check_held_settlement_has_source() from public, anon, authenticated;

drop trigger if exists investment_transactions_held_source_required on public.investment_transactions;
create constraint trigger investment_transactions_held_source_required
  after insert or update on public.investment_transactions
  deferrable initially deferred
  for each row
  when (new.held_for_merge)
  execute function public.check_held_settlement_has_source();

-- ─── the shape, as a constraint ──────────────────────────────────────────────
--
-- The RPC is the only writer that should produce this row, but a constraint is
-- what makes that true of every writer — including a service-role script and any
-- endpoint added later. A held row that is not a withdrawal is not closing
-- anything, and one with no target goal drops its cash out of net worth.
--
-- "Must name a parent" is NOT here: it lives in the deferred trigger above,
-- because ON DELETE SET NULL makes it a question that can only be answered at
-- the end of the transaction.
--
-- The fourth is the two goal columns agreeing. The dashboard shows the parked
-- cash under merge_target_goal_id, while renew_term_deposit_with_merge only lets
-- a deposit consume a held row whose goal_id matches its own — diverge them and
-- the settlement is displayed in one goal and consumable only from another. The
-- app has always written them equal, so this pins what was already true.
--
-- NOT VALID on purpose. This validates every INSERT and UPDATE from here on, but
-- does not scan rows written before it — the same stance #611 takes toward the
-- withdrawal ledger, and for the same reason: a migration that refuses to apply
-- against real history blocks the deploy instead of protecting it. Legacy held
-- rows all came from MaturityResolveSheet, which has always sent a parent, so
-- this is expected to be a formality; run
--   alter table public.investment_transactions
--     validate constraint investment_transactions_held_shape;
-- once that has been confirmed against production.
alter table public.investment_transactions
  drop constraint if exists investment_transactions_held_shape;

alter table public.investment_transactions
  add constraint investment_transactions_held_shape
  check (
    not held_for_merge or (
      transaction_type = 'withdrawal'
      -- A settlement closes a BANK deposit (the source rules allow nothing else),
      -- so the row that closes it is a bank withdrawal. Found by auditing every
      -- column the RPC writes against what actually validates it — this was the
      -- only one with no guard at all.
      and asset_type = 'bank'
      and merge_target_goal_id is not null
      -- IS NOT DISTINCT FROM, not `=`: a CHECK passes on UNKNOWN, so plain
      -- equality lets an UPDATE set goal_id = NULL straight through — the
      -- dashboard would go on displaying the cash under the non-null target
      -- while the merge refuses it for a goal that no longer matches. Paired
      -- with the non-null target above, this forces goal_id to that same goal.
      and merge_target_goal_id is not distinct from goal_id
    )
  ) not valid;

-- The withdrawal invariant's held exemption (20260730000002) stays as written.
-- It is now unreachable for any NEW row — the constraint above requires a parent,
-- so a held row can never take the "draws on no holding" branch — but it must
-- keep letting the legacy rows through, which the constraint does not touch.
comment on constraint investment_transactions_held_shape on public.investment_transactions is
  'A held-for-merge settlement must close a real deposit and name where its cash is earmarked (#588).';
