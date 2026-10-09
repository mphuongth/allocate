-- Two SECURITY DEFINER paths that answered a caller with facts about someone
-- else's rows (#760, #761).

-- ─── #760: the successor-pairing check is for the trigger only ───────────────
--
-- assert_successor_book_pairing reads a book by id alone, locks it and its
-- successor FOR UPDATE, and raises errors that carry their maturity dates and
-- state. #638 revoked PUBLIC from open_successor_book and cancel_successor_book
-- but not from this one, so anon and every signed-in user could call it through
-- /rpc with another account's book id. Its only caller is the definer trigger
-- enforce_successor_book_pairing, which runs as the owner and needs no grant.
revoke all on function public.assert_successor_book_pairing(uuid) from public, anon, authenticated;

-- ─── #761: a goal check only looks at the row owner's goals ──────────────────
--
-- BEFORE triggers fire in name order, so on funds this guard runs before
-- funds_fk_ownership. Reading the goal with no user filter, it told A whether
-- B's goal was finished ("completed goal"), missing ("deleted goal") or live
-- (passed through to the ownership error), and took a FOR SHARE lock on it.
-- Scoped to new.user_id, a foreign goal reads exactly like a missing one, and
-- nothing outside the caller's account is locked.
--
-- On every table that uses this function a goal reference must already belong
-- to the row's owner (the #525 ownership triggers), so the filter refuses
-- nothing that was allowed before.
create or replace function public.enforce_goal_not_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_col text := tg_argv[0];
  v_new uuid;
  v_old uuid;
  v_completed timestamptz;
begin
  execute format('select ($1).%I', v_col) into v_new using new;
  if v_new is null then return new; end if;
  -- An unchanged reference is nothing new to check — EXCEPT where the trigger is
  -- armed as 'recheck', which is how a fund asks about a goal it has pointed at
  -- all along. Switching DCA back on writes is_dca and the amount and leaves
  -- dca_goal_id exactly as it was, so short-circuiting on it would wave through
  -- a plan aimed at an archive.
  if tg_op = 'UPDATE' and coalesce(tg_argv[1], '') <> 'recheck' then
    execute format('select ($1).%I', v_col) into v_old using old;
    if v_old is not distinct from v_new then return new; end if;
  end if;
  -- FOR SHARE, not a plain read. finish_savings_goal holds FOR UPDATE on the
  -- goal for the whole liquidation, and delete_savings_goal holds it for the
  -- whole deletion; a plain EXISTS does not participate in either lock. The row
  -- read once the lock is granted is the post-finish, post-delete version.
  --
  -- Only the row owner's goals: this runs as definer, so without the filter it
  -- would read — and lock — any account's goal and say what state it is in.
  select g.completed_at into v_completed
    from public.savings_goals g
   where g.goal_id = v_new
     and g.user_id = new.user_id
     for share;
  -- FOUND, not a flag selected into a variable. `select true into v_found` leaves
  -- v_found NULL when there is no row, and `if not null` takes the ELSE branch —
  -- so the guard below would never fire in the one case it exists for.
  if not found then
    raise exception 'deleted goal: this goal no longer exists'
      using errcode = 'foreign_key_violation';
  end if;
  if v_completed is not null then
    raise exception 'completed goal: this goal has been finished, so it takes no new money — reopen it first'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.enforce_goal_not_completed() is
  'Refuses to point a new holding, recurring saving or DCA plan at an archived goal, or at one deleted out from under the write (#650, #687). Reads only the row owner''s goals (#761). The reference column is tg_argv[0].';
