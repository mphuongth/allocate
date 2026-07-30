-- A withdrawal may never take more than its holding still holds (#587).
--
-- The sell/withdraw sheets capped the amount client-side (computeSellPreview's
-- sellOverMax / isOverUnits); POST /api/v1/investment-transactions validated the
-- numeric shape and inserted whatever it was given. So a stale tab, a retried
-- request, or two sells racing each other could each pass their own read of the
-- balance and both land: the holding goes past zero, the dashboard drops it
-- (valueNonFundHolding returns null at effectiveAmount <= 0) while the excess
-- withdrawal stays in history, and net worth and P&L are wrong from then on.
--
-- Why a trigger and not a service or an RPC the route calls: the balance has
-- several writers already — this route, renew_term_deposit_with_merge,
-- withdraw_accumulating_book, record_recurring_book_topup — and the next one is
-- written by whoever forgets. An invariant on the table holds for all of them,
-- including service-role and SQL writes, which is the same reasoning that moved
-- the recurring-link cleanup into the database in #531.
--
-- Why it is atomic: the check LOCKS THE SOURCE ROWS FIRST, then reads the sums in
-- a following statement. Under READ COMMITTED a competing insert holds that lock
-- until it commits, and the statement that reads the sums afterwards takes a new
-- snapshot — so the second withdrawal sees the first one and is measured against
-- the balance it left behind. Reading the sums first would let both pass.
--
-- ─── The withdrawal decision table ───────────────────────────────────────────
-- What a valid withdrawal looks like, per kind. This is the contract; every row
-- here has direct coverage in supabase/tests/withdrawal_balance.test.sql, and each
-- invalid near-neighbour has a refusal test. The schema alone cannot express it —
-- asset_type, fund_id, parent_transaction_id, principal_withdrawn and
-- units_withdrawn are all nullable and can coexist in shapes the UI never makes —
-- so the API states it too (POST /api/v1/investment-transactions), and this
-- function enforces it over whatever reaches the table.
--
--   Kind        | Holding (balance) key   | Required deltas
--   ------------|-------------------------|--------------------------------------
--   Fund        | (goal_id, fund_id)      | units > 0, and principal = the
--               |   asset_type='fund'     | units-proportional share of the
--               |                         | remaining basis (±1 đồng)
--   Gold        | parent_transaction_id   | units > 0 and principal > 0
--   Bank/stock  | parent_transaction_id   | principal > 0 (no units to move)
--   Held-for-   | none, by definition     | claims NOTHING: no principal, no
--   merge with  |                         | units. Making it source-backed is
--   no source   |                         | #588; it is not silently treated as
--               |                         | an ordinary withdrawal here.
--
-- The two balances the keys resolve to, mirroring what the dashboard aggregates:
--   • bank / gold / stock — one source row, addressed by parent_transaction_id:
--     remaining principal = amount_vnd − Σ principal_withdrawn, remaining units =
--     units − Σ units_withdrawn (lib/depositValuation values it exactly so).
--   • fund — a sell has no parent row; the overview aggregates funds per
--     (goal_id, fund_id), so that bucket is the balance a sell draws down.
--
-- Fund principal is BOUND to units, not merely capped: capping them independently
-- let a sale of 1 unit out of 100 claim the whole basis and leave 99 units with
-- none. One allocation rule, shared by lib/fundWithdrawal (what the sheets post),
-- the overview (how it reduces a bucket) and this function (what it will accept).
--
-- Why the check runs from TWO triggers. A new claim (an insert, or an edit that
-- raises the amounts) is measured IMMEDIATELY: the error points at the statement
-- that caused it, and the lock is then held for the rest of the transaction.
-- But MOVING a withdrawal between buckets is a multi-row change —
-- POST /api/v1/fund-investments/assign relocates a fund's purchases AND its sells
-- in one UPDATE, and deleting a goal does the same through ON DELETE SET NULL. A
-- row-level trigger sees such a statement half-applied, so whether the destination
-- bucket looked complete depended on heap order: an ordinary "buy, sell, edit the
-- buy, assign the fund to a goal" failed. Relocations are therefore measured by a
-- CONSTRAINT trigger, which runs at the END OF THE STATEMENT — once the whole move
-- has landed and the destination bucket is whatever it is going to be.
--
-- Every refusal here is prefixed 'withdrawal invariant:' so the API can map the
-- whole family to a 400 with one match. Adding a new refusal used to mean
-- remembering to add a phrase to the route, and forgetting made an invalid request
-- look like a server fault.
--
-- Not covered here, deliberately: lowering a *source's* amount_vnd below what has
-- already been withdrawn (an edit, not a withdrawal) is the mirror hole and wants
-- its own guard — collapse and renewal both rewrite amounts mid-transaction, so
-- checking them needs care this change doesn't have room for.

-- The measurement itself, so the two triggers below share one implementation
-- instead of drifting apart. Raises check_violation; returns quietly otherwise.
create or replace function public.check_withdrawal_balance(wd public.investment_transactions)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Clients round units_withdrawn to 4 decimals (parseFloat(u.toFixed(4))), so a
  -- FULL sell can post a hair more than the holding: 50.12345 units becomes
  -- 50.1235. Allow exactly that much and no more, or "sell everything" breaks.
  c_units_epsilon constant numeric := 0.0001;
  v_principal     bigint;
  v_units         numeric;
  v_out_principal bigint;
  v_out_units     numeric;
  v_left          bigint;
  v_left_units    numeric;
  v_parent_type   text;
  v_parent_asset  text;
  -- Purchases in the fund bucket; null outside that branch, which is also how the
  -- allocation rule below knows which kind it is measuring.
  v_rows          int;
  -- The basis a fund sale of these units is allowed to take, and the one đồng of
  -- rounding the proportional split can produce.
  v_expected      numeric;
  c_dong_epsilon  constant numeric := 1;
begin
  if wd.transaction_type is distinct from 'withdrawal' then return; end if;

  -- A negative withdrawal runs the ledger backwards: it ADDS to the holding and
  -- banks a credit the next withdrawal can spend (the sums below are signed, and
  -- so is lib/depositValuation's subtraction). Nothing in the schema stops one, so
  -- the invariant does — before anything is measured, since a negative amount
  -- would poison the measurement itself.
  if coalesce(wd.principal_withdrawn, 0) < 0 or coalesce(wd.units_withdrawn, 0) < 0 then
    raise exception 'withdrawal invariant: amounts cannot be negative (principal %, units %)',
      wd.principal_withdrawn, wd.units_withdrawn using errcode = 'check_violation';
  end if;

  -- The branch order is not a preference: it MIRRORS lib/withdrawalProgress, which
  -- keys any row with asset_type='fund' + fund_id by (goal, fund) and ignores its
  -- parent. Measuring such a row against a parent instead would check a balance
  -- nothing draws down — a fat holding in one goal waving through a phantom fund
  -- sell in another, since the API accepts both fields on one row.
  if wd.asset_type = 'fund' and wd.fund_id is not null then
    -- A fund sale is a quantity: without units the overview skips the whole
    -- subtraction (it bails on `wd.units <= 0`) and the holding keeps its value.
    -- The principal is then not a free number — it is the allocation of the
    -- remaining basis for those units, checked at the end of this function.
    if coalesce(wd.units_withdrawn, 0) <= 0 then
      raise exception 'withdrawal invariant: a fund sale must record units_withdrawn (got %)',
        wd.units_withdrawn using errcode = 'check_violation';
    end if;

    -- Both sides of the bucket carry `asset_type = 'fund'`, because that is what
    -- the valuation counts: a row whose asset_type was edited off 'fund' keeps its
    -- fund_id (the PUT clears fund_id only when that field is sent) but is valued
    -- as a bank holding, so its units are no longer fund inventory to sell.
    --
    -- Lock the bucket's investment rows before measuring them (see the header):
    -- this is what makes two concurrent sells of the same bucket serialize. Pending
    -- DCA seeds (units is null) are excluded: they carry a planned amount with no
    -- units bought yet, the dashboard never values them, so they hold nothing to
    -- sell. Renewal snapshots are history copies, not holdings.
    perform 1
      from public.investment_transactions t
     where t.user_id = wd.user_id
       and t.fund_id = wd.fund_id
       and t.asset_type = 'fund'
       and t.transaction_type = 'investment'
       and t.goal_id is not distinct from wd.goal_id
       and t.renewed_from_transaction_id is null
       and t.units is not null
     order by t.transaction_id      -- a stable lock order; concurrent sells can't deadlock
       for update;

    -- ONE authoritative basis: Σ amount_vnd, what the purchases cost. That is
    -- where the number lands — dashboard/overview does
    --   acc.totalInvested -= Σ principal_withdrawn
    -- against exactly this sum, while the NAV cost (Σ units × unit_price, fees
    -- excluded) is reduced by units and only feeds the average entry price.
    --
    -- The sheets used to post a NAV-derived figure into that amount-based
    -- accumulator, reconstructed through the averaged purchasePrice, and this check
    -- grew a tolerance to accommodate it. lib/fundWithdrawal now takes the basis
    -- from the dashboard directly (a full sale takes it exactly), so the two agree
    -- and the tolerance below covers only what rounding can still explain.
    select coalesce(sum(t.amount_vnd), 0), coalesce(sum(t.units), 0), count(*)
      into v_principal, v_units, v_rows
      from public.investment_transactions t
     where t.user_id = wd.user_id
       and t.fund_id = wd.fund_id
       and t.asset_type = 'fund'
       and t.transaction_type = 'investment'
       and t.goal_id is not distinct from wd.goal_id
       and t.renewed_from_transaction_id is null
       and t.units is not null;

    select coalesce(sum(w.principal_withdrawn), 0), coalesce(sum(w.units_withdrawn), 0)
      into v_out_principal, v_out_units
      from public.investment_transactions w
     where w.user_id = wd.user_id
       and w.fund_id = wd.fund_id
       and w.asset_type = 'fund'
       and w.transaction_type = 'withdrawal'
       and w.goal_id is not distinct from wd.goal_id
       and w.transaction_id <> wd.transaction_id;   -- measured without itself

  elsif wd.parent_transaction_id is not null then
    -- Bank / gold / stock: one source row. Lock it before measuring it, so two
    -- concurrent withdrawals of the same deposit serialize here.
    select t.amount_vnd, t.units, t.transaction_type, t.asset_type
      into v_principal, v_units, v_parent_type, v_parent_asset
      from public.investment_transactions t
     where t.transaction_id = wd.parent_transaction_id
       and t.user_id = wd.user_id
       for update;
    -- A parent that isn't the writer's own is the ownership trigger's refusal to
    -- make (#474 / #525); staying quiet here keeps that message the one the user
    -- sees instead of a confusing "no balance".
    if not found then return; end if;

    -- A withdrawal is not a holding, so parenting to one invents a balance out of
    -- money that already left. Renewal snapshots ARE valid parents on purpose:
    -- renew and collapse re-parent partial withdrawals onto them, which is how a
    -- renewed deposit stops double-counting them (#585).
    --
    -- A parent that is a FUND purchase is left alone here, though review flagged
    -- it: such a row is ignored by buildWithdrawalMaps (the fund is valued through
    -- the goal/fund map, which never consults parentWdMap), so it is an UNCOUNTED
    -- withdrawal rather than an overdraw — a valuation gap that predates this
    -- change, and one supabase/tests/dca_seeding_heal.test.sql treats as data that
    -- exists (issue #606). Bounding it by the parent's own principal, as below, is
    -- the most this invariant can honestly say about it.
    if v_parent_type is distinct from 'investment' then
      raise exception 'withdrawal invariant: draws on no holding — its parent % is not an investment',
        wd.parent_transaction_id using errcode = 'check_violation';
    end if;

    -- Gold is the one non-fund holding valued by QUANTITY: valueNonFundHolding
    -- prices it as units × gold price and takes its cost basis from amount_vnd. So
    -- a sale must move both, exactly as a fund sell must. Principal alone drops the
    -- basis while every chỉ stays in net worth — P&L inflated and the sold gold
    -- never leaves; units alone removes the metal and leaves its cost behind.
    -- Keyed off the PARENT's type, not the withdrawal's: the row's own asset_type
    -- is nullable and the route lets it be omitted. Bank and stock are unaffected —
    -- their valuation is principal-only, and a deposit has no units to move.
    if v_parent_asset = 'gold' and coalesce(wd.units_withdrawn, 0) <= 0 then
      raise exception 'withdrawal invariant: a gold sale must record units_withdrawn (got %)',
        wd.units_withdrawn using errcode = 'check_violation';
    end if;

    -- A withdrawal that records no principal takes nothing out of the holding:
    -- lib/depositValuation subtracts coalesce(principal_withdrawn, 0), so the
    -- deposit keeps its full value while the row claims cash left. A withdrawal
    -- must not be valid merely because the number to measure was omitted.
    if coalesce(wd.principal_withdrawn, 0) <= 0 then
      raise exception 'withdrawal invariant: a withdrawal from holding % must record a positive principal_withdrawn (got %)',
        wd.parent_transaction_id, wd.principal_withdrawn using errcode = 'check_violation';
    end if;

    select coalesce(sum(w.principal_withdrawn), 0), coalesce(sum(w.units_withdrawn), 0)
      into v_out_principal, v_out_units
      from public.investment_transactions w
     where w.parent_transaction_id = wd.parent_transaction_id
       and w.transaction_type = 'withdrawal'
       -- Same precedence as the branch above, applied to the OTHER rows: a sibling
       -- that is keyed by a fund draws on that bucket, not on this parent, so
       -- counting it here too would charge it twice and make an ordinary later
       -- withdrawal of this deposit look like an overdraw.
       --
       -- coalesce, because asset_type is nullable and the route lets a caller omit
       -- it: written bare, the predicate is NULL for a row with a fund_id and no
       -- asset_type, which DROPS it from this sum — while buildWithdrawalMaps
       -- counts that row against the parent (the fund key needs asset_type =
       -- 'fund'). Two full withdrawals of one deposit both passed that way.
       and not coalesce(w.asset_type = 'fund' and w.fund_id is not null, false)
       and w.transaction_id <> wd.transaction_id;

  else
    -- Nothing identifiable to draw down. A row taking principal or units out of no
    -- holding at all is not a withdrawal — buildWithdrawalMaps files it under
    -- neither key, so it subtracts from nothing while the record claims cash left.
    -- Reachable by editing a fund sell's asset_type off 'fund' (the fund_id stays,
    -- but the row leaves the fund bucket), which is why asset_type fires the
    -- trigger: running is not enough, the new shape has to be refused.
    if coalesce(wd.principal_withdrawn, 0) > 0 or coalesce(wd.units_withdrawn, 0) > 0 then
      raise exception 'withdrawal invariant: draws on no holding — it has neither a parent transaction nor a fund'
        using errcode = 'check_violation';
    end if;
    -- Carrying neither delta leaves nothing to measure, and exactly ONE kind of row
    -- is allowed to be in that state: a held-for-merge settlement whose source is
    -- not recorded yet (#588 makes them source-backed). The exception is for that
    -- pool, so nothing else may wear it — an ordinary withdrawal has to name what it
    -- draws on, or it is cash leaving no holding at all. held_for_merge is in the
    -- trigger's UPDATE OF list too, so an allowed held row cannot become an
    -- ordinary one by dropping the flag.
    if not wd.held_for_merge then
      raise exception 'withdrawal invariant: draws on no holding — only a held-for-merge settlement may omit its source'
        using errcode = 'check_violation';
    end if;
    return;
  end if;

  -- What the holding has left, after everything already taken out of it.
  v_left := coalesce(v_principal, 0) - v_out_principal;
  v_left_units := coalesce(v_units, 0) - v_out_units;

  -- Quantity bound, for whichever kinds carry units.
  if coalesce(wd.units_withdrawn, 0) > 0 then
    -- The tolerance rounds a real balance; it does not create one. Applied to an
    -- empty holding it would hand every sold-out bucket 0.0001 units it never had.
    if wd.units_withdrawn > v_left_units + (case when v_left_units > 0 then c_units_epsilon else 0 end) then
      raise exception 'withdrawal invariant: % units exceeds the remaining balance of % units on this holding',
        wd.units_withdrawn, v_left_units using errcode = 'check_violation';
    end if;
  end if;

  if v_rows is not null or v_parent_asset = 'gold' then
    -- ANY quantity-valued holding — a fund bucket, or gold — has its principal
    -- BOUND TO THE UNITS, not merely capped beside them. Capping the two
    -- independently let a sale of 1 unit out of 100 claim the whole basis and leave
    -- 99 units with none, which corrupts every later sale's allocation and the P&L,
    -- and eventually makes the rest unsellable for lack of basis. Gold behaves the
    -- same way: valueNonFundHolding prices it units × market and takes its basis
    -- from amount_vnd.
    --
    -- One allocation rule, shared with lib/fundWithdrawal and lib/goldWithdrawal and
    -- matching how the dashboard itself reduces a holding: a sale of ALL the
    -- remaining units takes the remaining basis exactly, and a partial sale takes
    -- its units-proportional share of it. ONE rounding rule: the two sides may
    -- differ by at most a đồng, which is what rounding a proportional slice can
    -- produce.
    if wd.units_withdrawn >= v_left_units - c_units_epsilon then
      v_expected := v_left;
    else
      v_expected := round(wd.units_withdrawn * v_left / v_left_units);
    end if;
    if abs(coalesce(wd.principal_withdrawn, 0) - v_expected) > c_dong_epsilon then
      raise exception 'withdrawal invariant: a sale of % units out of % must take % of the % basis, not %',
        wd.units_withdrawn, v_left_units, v_expected, v_left, wd.principal_withdrawn
        using errcode = 'check_violation';
    end if;

  elsif coalesce(wd.principal_withdrawn, 0) > 0 then
    -- Non-fund: the principal is the user's own figure (the amount they withdrew),
    -- bounded by what the holding still holds.
    if wd.principal_withdrawn > v_left then
      raise exception 'withdrawal invariant: % exceeds the remaining balance of % on this holding',
        wd.principal_withdrawn, v_left using errcode = 'check_violation';
    end if;
  end if;
end;
$$;

comment on function public.check_withdrawal_balance(public.investment_transactions) is
  'Raises when a withdrawal/sell would take more principal or units than its holding still has. Measured under a lock on the source, so concurrent sells cannot both pass (#587).';

-- Postgres grants EXECUTE on a new function to PUBLIC, and this one is SECURITY
-- DEFINER — so left open it is an oracle: call it with a hand-built row naming
-- someone else's holding, and the refusal message reports that holding's exact
-- remaining principal or units, RLS bypassed, taking row locks on the way. It is
-- the triggers' helper and nothing else's; they call it as the definer, so they
-- keep working without these grants.
revoke all on function public.check_withdrawal_balance(public.investment_transactions) from public;
revoke all on function public.check_withdrawal_balance(public.investment_transactions) from anon, authenticated;

-- ── immediate: a new or increased claim ──────────────────────────────────────
create or replace function public.enforce_withdrawal_within_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- Deleting a source is an ordinary ledger action, and BOTH links a withdrawal
    -- hangs on are ON DELETE SET NULL — the deposit (parent_transaction_id) and
    -- the fund (fund_id, which a sell is keyed by). So Postgres orphans the
    -- children with an UPDATE that lands right here, and measuring it would refuse
    -- the row (it just lost the holding it drew on) and turn a plain delete into an
    -- error.
    --
    -- Only the FK may orphan a row. Detaching a withdrawal from a source that is
    -- still there restores the holding to full value while the withdrawal is filed
    -- under no key at all — the same escape this function exists to close. The tell
    -- is the source itself: by the time the FK action fires, the referenced row is
    -- already deleted and invisible to these queries.
    if old.parent_transaction_id is not null and new.parent_transaction_id is null then
      if exists (select 1 from public.investment_transactions t
                  where t.transaction_id = old.parent_transaction_id) then
        raise exception 'withdrawal invariant: cannot be detached from holding %, which still exists',
          old.parent_transaction_id using errcode = 'check_violation';
      end if;
      -- The source is gone. If the row still names a fund it now draws on that
      -- bucket instead, so it has to be re-measured rather than waved through;
      -- with nothing left to draw on, the leftover orphan is a shape this
      -- invariant would not let anyone CREATE (issue #607).
      if new.fund_id is null then return new; end if;
    end if;

    if old.fund_id is not null and new.fund_id is null then
      if exists (select 1 from public.funds f where f.id = old.fund_id) then
        raise exception 'withdrawal invariant: cannot be detached from fund %, which still exists',
          old.fund_id using errcode = 'check_violation';
      end if;
      -- The fund is gone. buildWithdrawalMaps now keys the row by its PARENT, so
      -- if it has one, it must be measured against that balance — a sell that fit
      -- the fund bucket can overdraw a smaller deposit. With no parent either,
      -- it is the orphan case above.
      if new.parent_transaction_id is null then return new; end if;
    end if;

    -- A pure relocation: the claim is unchanged, only which bucket it sits in.
    -- Its destination is only complete once the whole statement has landed (a
    -- fund assign moves purchases and sells together), so the deferred trigger
    -- measures this one.
    --
    -- Every column that can change what the row IS has to be listed here, or the
    -- bypass hands out an exemption it was never meant to: held_for_merge was
    -- missing, so clearing it turned a permitted no-source held settlement into an
    -- ordinary sourceless withdrawal without anything re-measuring it. Keep this
    -- list in step with the trigger's `update of` columns — goal_id is the only one
    -- a relocation may touch.
    if new.principal_withdrawn is not distinct from old.principal_withdrawn
       and new.units_withdrawn is not distinct from old.units_withdrawn
       and new.parent_transaction_id is not distinct from old.parent_transaction_id
       and new.fund_id is not distinct from old.fund_id
       and new.asset_type is not distinct from old.asset_type
       and new.transaction_type = old.transaction_type
       and new.held_for_merge = old.held_for_merge then
      return new;
    end if;
  end if;

  perform public.check_withdrawal_balance(new);
  return new;
end;
$$;

comment on function public.enforce_withdrawal_within_balance() is
  'Measures a new or increased withdrawal claim against its holding as it is written (#587).';

drop trigger if exists investment_transactions_withdrawal_balance on public.investment_transactions;
create trigger investment_transactions_withdrawal_balance
  -- Every column that decides WHICH balance the row is measured against, plus the
  -- two that say how much it takes:
  --   • transaction_type — the WHEN clause reads it, so without it a row could be
  --     staged as an investment carrying principal_withdrawn (an investment draws
  --     nothing down, so it is not measured) and then activated by a one-column
  --     update that never fired this trigger.
  --   • asset_type — it picks the fund-bucket branch over the parent branch.
  --   • held_for_merge — it is what licenses the no-source shape, so clearing it
  --     has to re-measure the row rather than leave the exception behind.
  before insert or update of
    transaction_type, asset_type, principal_withdrawn, units_withdrawn,
    parent_transaction_id, fund_id, goal_id, held_for_merge
  on public.investment_transactions
  for each row
  when (new.transaction_type = 'withdrawal')
  execute function public.enforce_withdrawal_within_balance();

-- ── a bucket must be able to back the sales left in it ───────────────────────
-- The row-by-row checks above measure a WITHDRAWAL against its bucket. Nothing
-- measured the bucket after its PURCHASES moved away — and that is a reachable
-- state: an assign and a sell of the same fund racing each other leaves the sale in
-- the old bucket while its purchases move to the new one (the assign's UPDATE
-- cannot see a withdrawal inserted after its snapshot, so the row is never
-- relocated and no trigger fires for it). Verified with two sessions, and it
-- happens with these triggers disabled too, so it is the shape of the move rather
-- than anything this invariant introduced.
--
-- The dashboard then finds a withdrawal in a bucket with no accumulator, skips the
-- subtraction entirely, and the sold units come back — silent net-worth inflation,
-- exactly the class this migration exists to stop. So a relocation that would leave
-- a bucket owing more than it holds is refused: a failed assign can be retried, a
-- split bucket is found months later.
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

  if v_out_units > v_units + 0.0001 or v_out_basis > v_basis + 1 then
    raise exception 'withdrawal invariant: this fund bucket would be left owing % units / % of basis it does not hold',
      v_out_units - v_units, v_out_basis - v_basis using errcode = 'check_violation';
  end if;
end;
$$;

comment on function public.check_fund_bucket_solvent(uuid, uuid, uuid) is
  'Raises when a (goal, fund) bucket holds sales its purchases cannot back — the split a relocation can leave behind (#587).';

revoke all on function public.check_fund_bucket_solvent(uuid, uuid, uuid) from public;
revoke all on function public.check_fund_bucket_solvent(uuid, uuid, uuid) from anon, authenticated;

create or replace function public.enforce_fund_bucket_after_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Both ends: the bucket these purchases left, and the one they joined.
  perform public.check_fund_bucket_solvent(new.user_id, new.fund_id, old.goal_id);
  perform public.check_fund_bucket_solvent(new.user_id, new.fund_id, new.goal_id);
  return null;
end;
$$;

comment on function public.enforce_fund_bucket_after_move() is
  'Re-measures both buckets when a fund purchase changes goal, at the end of the statement so a whole-bucket move is seen complete (#587).';

drop trigger if exists investment_transactions_fund_bucket_moved on public.investment_transactions;
create constraint trigger investment_transactions_fund_bucket_moved
  after update of goal_id on public.investment_transactions
  -- End of statement, like the withdrawal relocation check: an assign moves the
  -- purchases and the sales in one UPDATE, and both ends are only settled once it
  -- has finished.
  deferrable initially immediate
  for each row
  when (new.transaction_type = 'investment' and new.fund_id is not null
        and new.goal_id is distinct from old.goal_id)
  execute function public.enforce_fund_bucket_after_move();

-- ── deferred: a relocation, measured once the statement has landed ───────────
create or replace function public.enforce_withdrawal_balance_after_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.investment_transactions;
begin
  -- Re-read the row rather than trusting the queued image: by commit it may have
  -- moved again, or been deleted, and the balance question is about what is
  -- actually there now.
  select * into v_row from public.investment_transactions t
   where t.transaction_id = new.transaction_id;
  if not found then return null; end if;
  if v_row.transaction_type is distinct from 'withdrawal' then return null; end if;
  -- Orphaned by a delete (see the immediate trigger): nothing to measure against,
  -- and refusing here would fail the delete that caused it.
  if v_row.fund_id is null and v_row.parent_transaction_id is null then return null; end if;

  perform public.check_withdrawal_balance(v_row);
  return null;
end;
$$;

comment on function public.enforce_withdrawal_balance_after_move() is
  'Re-measures a withdrawal that changed bucket, deferred to the end of the statement so a multi-row move (a fund assign, a deleted goal) is seen complete (#587).';

drop trigger if exists investment_transactions_withdrawal_balance_moved on public.investment_transactions;
create constraint trigger investment_transactions_withdrawal_balance_moved
  after update of goal_id on public.investment_transactions
  -- INITIALLY IMMEDIATE on a constraint trigger means "at the end of the
  -- statement", not "during it" — which is exactly the boundary a multi-row move
  -- needs. Deferring to commit would work too, but would report the problem far
  -- from the statement that caused it (and a caller can still SET CONSTRAINTS
  -- DEFERRED when it genuinely needs to move a bucket in several statements).
  deferrable initially immediate
  for each row
  when (new.transaction_type = 'withdrawal' and new.goal_id is distinct from old.goal_id)
  execute function public.enforce_withdrawal_balance_after_move();
