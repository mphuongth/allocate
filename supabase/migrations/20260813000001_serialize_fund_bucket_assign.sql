-- An assign waits for a concurrent sell of the same bucket instead of losing to
-- it (#610, follow-up to #589).
--
-- #589 made the assign ONE scoped UPDATE, which fixed the half of the problem
-- where it moved rows it should not have. It did not make assign and sell wait
-- for each other, and they contend for the same thing:
--
--   session 1: begin; insert a sell of 30 units      -- check_withdrawal_balance
--              …                                        locks the bucket's purchases
--   session 2: update … set goal_id = B where goal_id = A
--
-- Under READ COMMITTED the UPDATE's snapshot predates the sale, so the sale is
-- invisible to it: the purchases move, the sale stays behind, and the bucket is
-- split across two goals. lib/withdrawalProgress keys fund rows by
-- (goal_id, fund_id), so the orphaned sale stops offsetting the purchase it was
-- drawn on — goal B shows 100 units bought and nothing sold, goal A a sale against
-- no holding, and the sold units come back onto the dashboard. Reproduced with
-- both of #587's triggers disabled, so this is the shape of the move, not of the
-- invariant.
--
-- #587's check_fund_bucket_solvent already refuses such a relocation, which turns
-- silent corruption into a failed assign — the right trade, and not the fix. The
-- move was never invalid: the user assigned a fund to a goal, someone (they
-- themselves, in another tab) sold part of it, and the correct answer is to WAIT
-- and then move both rows. A refusal makes a legitimate action fail for a reason
-- the user cannot see or act on.
--
-- ─── Which lock, and in which order ──────────────────────────────────────────
--
-- A lock only one side takes serializes nothing, so the assign takes the lock the
-- SELL already takes: `select … for update` over the bucket's purchase rows, with
-- the sell's own predicate and the sell's own `order by transaction_id`. Same
-- rows, same order, so the two cannot deadlock against each other — one of them
-- waits at the first row and the other finishes.
--
-- An advisory lock on the bucket key was the alternative (check_fund_bucket_solvent
-- takes one, for the edit-vs-edit race #608 describes). It was not chosen here
-- because the sell path does not take it, so adopting it would have meant
-- re-issuing check_withdrawal_balance — 300 lines of decision table — to add one
-- statement, and would have introduced an ordering between two lock kinds that the
-- edit path takes in the opposite sequence. Reusing the row locks needs neither.
--
-- What the wait buys is a fresh read: the FOR UPDATE and the UPDATE are separate
-- statements, so under READ COMMITTED (what PostgREST and every RPC here run at)
-- the UPDATE takes its snapshot after the winner committed, and the sale it
-- inserted is inside the move. The loser of the opposite ordering — an assign that
-- commits while a sell waits — is not a split either: the sell then measures a
-- bucket whose purchases have left and is refused, which is what selling units
-- that are no longer in that goal should do.
--
-- Deadlock does not disappear, it becomes an expected answer: an EDIT of a row in
-- the bucket holds that row's lock before check_source_backs_claims asks for the
-- bucket's advisory lock, so an edit and an assign can still cross. Postgres
-- aborts one with 40P01, and the route answers 409 — try again — rather than 500.
--
-- The move itself is unchanged from the route's statement, including the two
-- filters that carry the fix from #589: the source bucket is addressed by goal id
-- (null being Unallocated), and pending DCA seeds are left where they are (they
-- carry a planned amount with no units bought yet — GET /fund-investments hides
-- them and the dashboard never values them, so the assign never moved them).
create or replace function public.assign_fund_bucket(
  p_fund_id uuid,
  p_from_goal_id uuid,
  p_to_goal_id uuid
)
returns setof uuid
-- INVOKER, deliberately: RLS is the ownership check for the rows being moved, and
-- it is the same one the route's UPDATE ran under. The destination goal is the
-- caller's own by the FK-ownership trigger (#607) and by the route's explicit
-- 403 lookup before it gets here.
security invoker
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'assign fund bucket: no session' using errcode = 'insufficient_privilege';
  end if;
  if p_from_goal_id is not distinct from p_to_goal_id then
    raise exception 'assign fund bucket: source and destination must differ' using errcode = 'invalid_parameter_value';
  end if;

  -- The sell's lock, taken the sell's way (20260803000005). Purchases only, in
  -- transaction_id order: a sell of this bucket is queued behind whichever of the
  -- two arrived first, and the statement below then reads what it committed.
  perform 1
    from public.investment_transactions t
   where t.user_id = v_user
     and t.fund_id = p_fund_id
     and t.asset_type = 'fund'
     and t.transaction_type = 'investment'
     and t.goal_id is not distinct from p_from_goal_id
     and t.renewed_from_transaction_id is null
     and t.units is not null
   order by t.transaction_id
     for update;

  return query
    update public.investment_transactions t
       set goal_id = p_to_goal_id,
           updated_at = now()
     where t.user_id = v_user
       and t.fund_id = p_fund_id
       and t.asset_type = 'fund'
       and t.goal_id is not distinct from p_from_goal_id
       and (t.is_dca_seeded = false or t.units is not null)
    returning t.transaction_id;
end;
$$;

comment on function public.assign_fund_bucket(uuid, uuid, uuid) is
  'Moves every row of one fund from one goal bucket to another, under the row locks a concurrent sell of that bucket takes, so the two serialize instead of racing (#589, #610).';

revoke all on function public.assign_fund_bucket(uuid, uuid, uuid) from public;
grant execute on function public.assign_fund_bucket(uuid, uuid, uuid) to authenticated;
