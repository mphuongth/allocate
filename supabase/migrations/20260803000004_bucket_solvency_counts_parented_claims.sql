-- A fund bucket's solvency must count every claim the dashboard counts (#606).
--
-- check_fund_bucket_solvent refuses a relocation that would leave a bucket owing
-- more units or basis than it holds (#587): an assign moves a fund's purchases,
-- and a sale left behind in the old bucket is silent net-worth inflation. It sums
-- the sales the reader summed at the time — fund-keyed rows only.
--
-- #606 gave the reader a second kind of claim on the same bucket: a withdrawal
-- parented to a fund purchase draws on that purchase's (goal, fund) bucket, at its
-- recorded units or, with none recorded, the pro-rata share of the purchase it
-- names. Those claims were invisible here, so a move could be waved through that
-- the dashboard then reads as an overdraw:
--
--   two 50-unit purchases in one bucket, a 45-unit fund-keyed sell, and a legacy
--   10-unit claim parented to the first purchase. Move the SECOND purchase to
--   another goal — a single-row edit, which nothing about it relocates the claims —
--   and 50 units are left backing 55. This function saw 45 and accepted it; the
--   overview subtracts all 55 and drops the remaining five units.
--
-- So the sale sum below is the reader's sum. `units > 0` on the purchase mirrors
-- lib/withdrawalProgress exactly: a purchase with no units is no bucket (the
-- dashboard values it as an ordinary holding), so its withdrawal stays on the
-- parent axis and is not a claim here.
--
-- Whole-bucket moves are unaffected, which is what keeps this from wedging the
-- ordinary paths: a fund assign moves the purchases, and a parented claim is keyed
-- by its parent's goal, so it moves with the purchase it names. Deleting a goal
-- moves everything in it at once, for the same reason. What is refused is a
-- relocation that genuinely splits the claims from what backs them.
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
begin
  select coalesce(sum(t.units), 0), coalesce(sum(t.amount_vnd), 0)
    into v_units, v_basis
    from public.investment_transactions t
   where t.user_id = p_user and t.fund_id = p_fund and t.asset_type = 'fund'
     and t.transaction_type = 'investment'
     and t.goal_id is not distinct from p_goal
     and t.renewed_from_transaction_id is null
     and t.units is not null;

  select coalesce(sum(w.units_withdrawn), 0), coalesce(sum(w.principal_withdrawn), 0)
    into v_out_units, v_out_basis
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
         coalesce(sum(coalesce(w.principal_withdrawn, 0)), 0)
    into v_par_units, v_par_basis
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

  if v_out_units > v_units + 0.0001 or v_out_basis > v_basis + 1 then
    raise exception 'withdrawal invariant: this fund bucket would be left owing % units / % of basis it does not hold',
      v_out_units - v_units, v_out_basis - v_basis using errcode = 'check_violation';
  end if;
end;
$$;

comment on function public.check_fund_bucket_solvent(uuid, uuid, uuid) is
  'Raises when a (goal, fund) bucket would be left owing more units or basis than its purchases hold, counting every claim the dashboard counts — fund-keyed sells and withdrawals parented to a purchase in the bucket (#587, #606).';

revoke all on function public.check_fund_bucket_solvent(uuid, uuid, uuid) from public;
revoke all on function public.check_fund_bucket_solvent(uuid, uuid, uuid) from anon, authenticated;
