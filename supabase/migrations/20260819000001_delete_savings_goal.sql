-- Deleting a goal, as one transaction instead of four round trips (#687).
--
-- The DELETE route used to do this transition a statement at a time: count the
-- linked transactions, look for cash parked for a merge, clear the dead
-- merge_target_goal_id on settlements already consumed, then delete the goal —
-- with the errors of the first and third dropped. supabase-js has no
-- transaction, so between the third and the fourth there is a window nothing
-- closes: the cleanup commits, the delete fails, and consumed merge history has
-- lost the target it recorded while the goal it pointed at is still there. The
-- count could also describe a ledger the delete never saw.
--
-- ─── why a function and not a trigger ────────────────────────────────────────
--
-- 20260731000001 records why there is deliberately no trigger on savings_goals:
-- BEFORE DELETE also aborts `delete from auth.users`, where the settlement is
-- going away too and there is nothing left to protect, and an AFTER DELETE
-- deferred trigger never runs because the immediate one has already refused the
-- statement. That reasoning still holds — this function does not add one. It
-- moves the steps the ROUTE was already doing into the transaction they always
-- belonged in, and leaves every table trigger exactly where it is:
-- ON DELETE SET NULL still moves the transactions to Unassigned, and the #525
-- ownership trigger still has the last word on any reference left dangling.
create or replace function public.delete_savings_goal(p_goal_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_goal public.savings_goals;
  v_moved int;
  v_parked uuid;
begin
  -- Security invoker, so RLS decides what this can see: another user's goal is
  -- simply not there, and answers exactly as a goal that never existed does.
  --
  -- FOR UPDATE is also the serialization point. enforce_goal_not_completed takes
  -- FOR SHARE on the goal before any row may point at it (20260813000002), so a
  -- settlement being parked against this goal right now either lands first — and
  -- the blocker check below sees it — or waits here and then finds the goal gone.
  select * into v_goal from public.savings_goals
   where goal_id = p_goal_id
   for update;
  if not found then
    raise exception 'delete goal: goal not found' using errcode = 'no_data_found';
  end if;

  -- Cash parked in this goal for a merge (#588). The database refuses the delete
  -- either way — merge_target_goal_id has no foreign key, so it would be left
  -- pointing at a goal that no longer exists, and the #525 ownership trigger
  -- refuses that — but it refuses with a message about a goal reference, not
  -- about a settlement. Asking here is what turns that into something the user
  -- can act on: release the settlement, then the goal deletes.
  select t.transaction_id into v_parked
    from public.investment_transactions t
   where t.user_id = v_goal.user_id
     and t.held_for_merge
     and t.consumed_by_inv_id is null
     and (t.merge_target_goal_id = p_goal_id or t.goal_id = p_goal_id)
   limit 1;
  if v_parked is not null then
    raise exception 'delete goal: this goal has cash parked in it for a merge (%)', v_parked
      using errcode = 'check_violation';
  end if;

  -- Counted here, under the same lock that performs the delete, so the number the
  -- user is told is the number that moved.
  select count(*) into v_moved
    from public.investment_transactions t
   where t.user_id = v_goal.user_id
     and t.goal_id = p_goal_id;

  -- Settlements whose merge is already DONE are history, and the goal should not
  -- be stuck behind them. merge_target_goal_id has no foreign key, so the deletion
  -- would leave it pointing at nothing and the #525 ownership trigger would then
  -- refuse the very referential update the deletion depends on — which made a goal
  -- that had ever completed a held merge permanently undeletable. Adding the
  -- missing FK does not help: goal_id and merge_target_goal_id are two separate
  -- referential actions on the same row, and whichever runs first leaves the other
  -- dangling. Clearing it is deterministic, and safe because the pool skips
  -- consumed rows entirely — for them the target is dead metadata.
  update public.investment_transactions
     set merge_target_goal_id = null
   where user_id = v_goal.user_id
     and held_for_merge
     and consumed_by_inv_id is not null
     and merge_target_goal_id = p_goal_id;

  delete from public.savings_goals where goal_id = p_goal_id;

  return jsonb_build_object('moved', v_moved);
end;
$$;

comment on function public.delete_savings_goal(uuid) is
  'Deletes a goal and the dead merge targets that would block it, in one transaction, returning how many transactions moved to Unassigned (#687).';

revoke all on function public.delete_savings_goal(uuid) from public;
grant execute on function public.delete_savings_goal(uuid) to authenticated;

-- ─── a reference to a goal that is GONE is refused here too ──────────────────
--
-- enforce_goal_not_completed already reads the goal FOR SHARE so a write cannot
-- slip under a finish that is holding FOR UPDATE. The same read answered nothing
-- at all when the goal row was absent: `v_completed` stayed null and the trigger
-- waved the row through.
--
-- For goal_id that is harmless — a real foreign key refuses it a moment later.
-- merge_target_goal_id has no foreign key, and its only other guard, the #525
-- ownership trigger, reads without a lock: against a delete committing right
-- beside it, that read sees the goal as still present, passes, and the row
-- commits pointing at nothing. Under the delete's FOR UPDATE this read is the one
-- that waits, so it is the one that can tell — and now does.
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
  select g.completed_at into v_completed
    from public.savings_goals g
   where g.goal_id = v_new
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
  'Refuses to point a new holding, recurring saving or DCA plan at an archived goal, or at one deleted out from under the write (#650, #687). The reference column is tg_argv[0].';
