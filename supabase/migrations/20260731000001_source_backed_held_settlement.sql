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
  c_amount_factor constant int := 10;
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

  select * into v_src
    from public.investment_transactions
   where transaction_id = p_source_id
   for update;
  if not found then
    raise exception 'held settlement: the deposit being settled was not found'
      using errcode = 'no_data_found';
  end if;

  -- Eligibility, mirroring the merge RPC's ruleset for a live source
  -- (20260620000006): a plain, active, single bank term deposit. A withdrawal
  -- has nothing to close; a fund/gold holding is not settled this way; an
  -- accumulating book spans tranches this one row could not close; a renewal
  -- snapshot is already a closed cycle.
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

  -- What the deposit still has, after any earlier partial withdrawal. This is
  -- both the amount the settlement closes and the second settlement's refusal.
  select v_src.amount_vnd - coalesce(sum(w.principal_withdrawn), 0)
    into v_eff
    from public.investment_transactions w
   where w.parent_transaction_id = p_source_id
     and w.transaction_type = 'withdrawal';

  if v_eff <= 0 then
    raise exception 'held settlement: this deposit has already been fully withdrawn'
      using errcode = 'check_violation';
  end if;

  if p_amount_vnd > v_eff * c_amount_factor then
    raise exception 'held settlement: % is unreasonably large for a deposit with % left', p_amount_vnd, v_eff
      using errcode = 'check_violation';
  end if;

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
  v_src public.investment_transactions;
  v_eff bigint;
begin
  -- A legacy held row predating the shape constraint may have no parent. It
  -- cannot be measured, and refusing every unrelated update to it would be a
  -- second, unannounced migration; the constraint is what stops NEW ones.
  if new.parent_transaction_id is null then return new; end if;

  select * into v_src
    from public.investment_transactions
   where transaction_id = new.parent_transaction_id;
  if not found then
    raise exception 'held settlement: the deposit being settled was not found'
      using errcode = 'no_data_found';
  end if;

  -- The source's remaining principal, EXCLUDING this row — so the bound reads
  -- the same on the insert that creates a settlement and on a later update to it.
  select v_src.amount_vnd - coalesce(sum(w.principal_withdrawn), 0)
    into v_eff
    from public.investment_transactions w
   where w.parent_transaction_id = new.parent_transaction_id
     and w.transaction_type = 'withdrawal'
     and w.transaction_id <> new.transaction_id;

  -- Full closure. "Để dành gộp" settles the deposit outright — that is what
  -- licenses the pool to add the cash back, because the deposit has stopped
  -- counting. Bounding the amount alone is not enough: a raw write could take
  -- principal_withdrawn = 1 against a 1,000,000 deposit and still claim
  -- amount_vnd = 10,000,000, leaving the deposit worth 999,999 in net worth
  -- while the pool adds ten million beside it. The RPC always closes the whole
  -- remaining principal; every other writer must too.
  if coalesce(new.principal_withdrawn, 0) <> v_eff then
    raise exception 'held settlement: must close the whole deposit — % left, but % taken', v_eff, coalesce(new.principal_withdrawn, 0)
      using errcode = 'check_violation';
  end if;

  if new.amount_vnd > greatest(v_eff, 0) * 10 then
    raise exception 'held settlement: % is unreasonably large for a deposit with % left', new.amount_vnd, v_eff
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- Not callable by the API roles: it is a trigger body, and an endpoint reaching
-- for it directly would be reading half an invariant. Mirrors the withdrawal
-- invariant's helper, whose lockdown withdrawal_balance.test.sql pins.
revoke all on function public.check_held_amount_within_source() from public, anon, authenticated;

drop trigger if exists investment_transactions_held_amount_bound on public.investment_transactions;
-- UPDATE OF lists every column the bound reads, so no edit can move the row out
-- from under it: raising the amount, re-pointing the parent, or flipping the flag
-- on a row that was never measured.
create trigger investment_transactions_held_amount_bound
  before insert or update of amount_vnd, held_for_merge, parent_transaction_id, principal_withdrawn
  on public.investment_transactions
  for each row
  when (new.held_for_merge)
  execute function public.check_held_amount_within_source();

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
