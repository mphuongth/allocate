-- A matured term deposit can move into a fund, inside its own goal.
--
-- The workflow this serves: a monthly fund DCA is parked in a term deposit while
-- deposit rates are high. At maturity the user either renews it (the existing
-- renew_term_deposit flow) or, when the rate on offer has dropped below their
-- own threshold, moves principal + interest into the deposit's "target fund".
--
-- Moving is two writes that must happen together — a withdrawal that closes the
-- deposit and a purchase of the fund with the same money, filed under the same
-- goal. Done as two requests, a failure between them leaves the goal short by
-- the whole deposit (closed, nothing bought) or long by it (bought, never
-- closed). So it is one function, and the pair is linked so neither half can be
-- undone without the other.
--
-- What this migration adds:
--
--   1. user_settings.renew_min_rate_pct — the user's threshold. At or above it
--      the app suggests renewing principal + interest; below it, moving to the
--      target fund. NULL means "not chosen", answered with the app default (8%),
--      the same NULL-is-its-own-answer rule inflation_rate_pct follows.
--   2. investment_transactions.target_fund_id — on a single term deposit, the
--      fund its money goes to when it is not renewed. A renewal rolls the live
--      row forward in place, so the target survives renewal by construction.
--   3. investment_transactions.units_estimated — on a fund purchase, "the units
--      were priced at the NAV the app knew, not at the NAV the order filled at".
--      An open-ended fund fills days later; the app reminds the user to correct
--      the units and clears the flag when they do.
--   4. investment_transactions.moved_to_fund_tx_id — on the withdrawal, the
--      purchase it paid for. Deleting the purchase deletes the withdrawal with
--      it (the deposit comes back); deleting the withdrawal alone is refused,
--      because it would bring the deposit back while the purchase stays — the
--      same money counted twice in the goal.
--   5. move_deposit_to_fund(...) — the one way to write that pair.

-- ── 1) the renew-or-move threshold ───────────────────────────────────────────

alter table public.user_settings
  add column if not exists renew_min_rate_pct numeric(5, 2)
    check (renew_min_rate_pct is null or (renew_min_rate_pct >= 0 and renew_min_rate_pct <= 100));

comment on column public.user_settings.renew_min_rate_pct is
  'Deposit rate (%/yr) at or above which a maturing deposit is suggested for renewal rather than a move to its target fund. NULL = not chosen (the app default applies).';

-- ── 2) a deposit's target fund ───────────────────────────────────────────────

alter table public.investment_transactions
  add column if not exists target_fund_id uuid
    references public.funds(id) on delete set null;

-- Only a single bank term deposit has somewhere to go at maturity. A book's
-- tranches mature together and are settled by their own RPCs; a fund, gold or
-- stock holding is not a deposit; a withdrawal is not a holding.
alter table public.investment_transactions
  drop constraint if exists investment_transactions_target_fund_shape;
alter table public.investment_transactions
  add constraint investment_transactions_target_fund_shape check (
    target_fund_id is null
    or (transaction_type = 'investment'
        and asset_type = 'bank'
        and deposit_group_id is null)
  );

comment on column public.investment_transactions.target_fund_id is
  'On a single term deposit: the fund its principal + interest moves to when it is not renewed at maturity.';

-- The reference is user-scoped like every other (20260728000001).
drop trigger if exists investment_transactions_target_fund_fk_ownership on public.investment_transactions;
create trigger investment_transactions_target_fund_fk_ownership
  before insert or update of target_fund_id, user_id on public.investment_transactions
  for each row execute function public.enforce_user_scoped_fk_ownership(
    'target_fund_id', 'funds', 'id');

-- ── 3) a fund purchase priced at an estimated NAV ────────────────────────────

alter table public.investment_transactions
  add column if not exists units_estimated boolean not null default false;

-- An estimate of units needs units to be an estimate of. A pending DCA seed
-- (units IS NULL) is a different state — not priced at all — and is excluded
-- from valuation; an estimated purchase is priced and counts at full value.
alter table public.investment_transactions
  drop constraint if exists investment_transactions_units_estimated_shape;
alter table public.investment_transactions
  add constraint investment_transactions_units_estimated_shape check (
    not units_estimated
    or (transaction_type = 'investment' and asset_type = 'fund' and units is not null)
  );

comment on column public.investment_transactions.units_estimated is
  'On a fund purchase: units were priced at the NAV known when it was recorded, not the NAV the order filled at. Cleared when the user corrects the purchase.';

-- ── 4) the withdrawal names the purchase it paid for ─────────────────────────

alter table public.investment_transactions
  add column if not exists moved_to_fund_tx_id uuid
    references public.investment_transactions(transaction_id) on delete cascade;

alter table public.investment_transactions
  drop constraint if exists investment_transactions_moved_to_fund_shape;
alter table public.investment_transactions
  add constraint investment_transactions_moved_to_fund_shape check (
    moved_to_fund_tx_id is null
    or (transaction_type = 'withdrawal'
        and asset_type = 'bank'
        and parent_transaction_id is not null
        and not held_for_merge
        and moved_to_fund_tx_id is distinct from transaction_id)
  );

-- One purchase is paid for by one settlement.
create unique index if not exists investment_transactions_moved_to_fund_unique
  on public.investment_transactions (moved_to_fund_tx_id)
  where moved_to_fund_tx_id is not null;

comment on column public.investment_transactions.moved_to_fund_tx_id is
  'On the withdrawal that closed a deposit at maturity: the fund purchase its money paid for (move_deposit_to_fund).';

drop trigger if exists investment_transactions_moved_to_fund_fk_ownership on public.investment_transactions;
create trigger investment_transactions_moved_to_fund_fk_ownership
  before insert or update of moved_to_fund_tx_id, user_id on public.investment_transactions
  for each row execute function public.enforce_user_scoped_fk_ownership(
    'moved_to_fund_tx_id', 'investment_transactions', 'transaction_id');

-- The link is written by move_deposit_to_fund only. Written by hand it can pair
-- any withdrawal with any purchase, and the delete rules below would then tie
-- together two rows that never shared any money. Same mechanism as the
-- successor link (20260811000001): the function marks its own write; a real
-- session writing the column otherwise is refused. auth.uid() is null for the
-- service role, migrations and SQL maintenance, which keep their reach.
create or replace function public.enforce_moved_to_fund_written_by_rpc()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.moved_to_fund_tx_id is not null
      or tg_op = 'UPDATE' and new.moved_to_fund_tx_id is distinct from old.moved_to_fund_tx_id)
     and auth.uid() is not null
     and coalesce(current_setting('app.deposit_move_write', true), '') <> '1' then
    raise exception 'move to fund: a deposit is moved through move_deposit_to_fund, not by writing the link'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists investment_transactions_moved_to_fund_rpc_only on public.investment_transactions;
create trigger investment_transactions_moved_to_fund_rpc_only
  before insert or update of moved_to_fund_tx_id on public.investment_transactions
  for each row
  execute function public.enforce_moved_to_fund_written_by_rpc();

-- Stated as a grant as well; the trigger is what actually refuses (the stack
-- re-grants table privileges after migrations run — see 20260811000001).
revoke insert (moved_to_fund_tx_id), update (moved_to_fund_tx_id)
  on public.investment_transactions from anon, authenticated;

-- Undoing a move is deleting the PURCHASE: the FK cascades to the withdrawal,
-- and the deposit is whole again. Deleting the withdrawal on its own would
-- restore the deposit while the purchase stays — the goal would count the same
-- money twice. While the purchase exists, the withdrawal is not deletable.
--
-- During the cascade the purchase has already been removed, so the lookup finds
-- nothing and the delete goes through.
create or replace function public.refuse_orphaning_moved_purchase()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from public.investment_transactions
     where transaction_id = old.moved_to_fund_tx_id
  ) then
    raise exception 'move to fund: this withdrawal paid for a fund purchase — delete the purchase to undo the move'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists investment_transactions_moved_withdrawal_not_deletable on public.investment_transactions;
create trigger investment_transactions_moved_withdrawal_not_deletable
  before delete on public.investment_transactions
  for each row
  when (old.moved_to_fund_tx_id is not null)
  execute function public.refuse_orphaning_moved_purchase();

-- ── the active view re-expands its star ──────────────────────────────────────
--
-- `select *` is expanded once, at creation (20260816000002). Every reader of
-- the ledger goes through this view, so the new columns are invisible — and a
-- select naming one is a 400 — until it is restated.

create or replace view public.active_investment_transactions
  with (security_invoker = true) as
  select * from public.investment_transactions
  where renewed_from_transaction_id is null;

-- ── 5) move_deposit_to_fund ──────────────────────────────────────────────────
--
-- The caller names the deposit, what the bank paid out, the fund, and the
-- units and NAV of the purchase (the NAV the app knows — flagged as estimated).
-- Everything else — owner, goal, asset type, principal being closed — is read
-- off the deposit.
--
-- security invoker, so RLS is the ownership boundary: someone else's deposit is
-- not visible and reads as not found. The fund is checked row-to-row against
-- the deposit's owner, which also holds for a service-role caller.
--
-- The FOR UPDATE on the deposit is what makes two moves (or a move racing a
-- settlement) of one deposit impossible: the second waits, re-reads the
-- withdrawals, and finds nothing left to close.
--
-- The recurring-saving link to the deposit is not touched here: the withdrawal
-- closes the deposit, and the unlinker that fires on every closing withdrawal
-- (20260814000001) records it as 'closed' inside this same transaction.
create or replace function public.move_deposit_to_fund(
  p_deposit_id uuid,
  p_received_vnd bigint,
  p_fund_id uuid,
  p_units numeric,
  p_unit_price numeric,
  p_date date default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_dep       public.investment_transactions;
  v_date      date;
  v_remaining bigint;
  v_purchase  uuid;
  v_wd        uuid;
begin
  if p_received_vnd is null or p_received_vnd <= 0 then
    raise exception 'move to fund: the amount received must be positive'
      using errcode = 'check_violation';
  end if;
  if p_units is null or p_units <= 0 or p_unit_price is null or p_unit_price <= 0 then
    raise exception 'move to fund: the purchase needs positive units and NAV'
      using errcode = 'check_violation';
  end if;
  if p_deposit_id is null or p_fund_id is null then
    raise exception 'move to fund: name the deposit and the fund'
      using errcode = 'check_violation';
  end if;

  select * into v_dep
    from public.investment_transactions
   where transaction_id = p_deposit_id
   for update;
  if not found then
    raise exception 'move to fund: the deposit was not found'
      using errcode = 'no_data_found';
  end if;

  -- A plain, live, single bank term deposit — the same shape renew_term_deposit
  -- rolls forward. A book's tranches are settled by the book RPCs; a renewal
  -- snapshot is a closed cycle; a pledged deposit is frozen as collateral.
  if v_dep.transaction_type is distinct from 'investment' or v_dep.asset_type is distinct from 'bank' then
    raise exception 'move to fund: only a bank deposit can be moved to a fund'
      using errcode = 'check_violation';
  end if;
  if v_dep.deposit_group_id is not null then
    raise exception 'move to fund: an accumulating book cannot be moved to a fund'
      using errcode = 'check_violation';
  end if;
  if v_dep.renewed_from_transaction_id is not null then
    raise exception 'move to fund: a renewal snapshot is already closed'
      using errcode = 'check_violation';
  end if;
  if v_dep.interest_rate is null or v_dep.expiry_date is null then
    raise exception 'move to fund: only a term deposit has a maturity to move at'
      using errcode = 'check_violation';
  end if;
  if coalesce(v_dep.is_pledged, false) then
    raise exception 'move to fund: a pledged deposit is frozen as collateral'
      using errcode = 'check_violation';
  end if;

  -- On the Vietnam date (20260815000003), and not in the future: the purchase is
  -- a real order, recorded the day it was placed.
  v_date := coalesce(p_date, public.business_today());
  if v_date > public.business_today() then
    raise exception 'move to fund: the move cannot be dated in the future'
      using errcode = 'check_violation';
  end if;
  -- At maturity — with the one day of grace the renewal route allows. Before
  -- that, closing the deposit forfeits its interest: an early withdrawal, which
  -- is the withdraw sheet's business, not this one's.
  if v_date < v_dep.expiry_date - 1 then
    raise exception 'move to fund: the deposit has not matured yet'
      using errcode = 'check_violation';
  end if;

  perform 1 from public.funds where id = p_fund_id and user_id = v_dep.user_id;
  if not found then
    raise exception 'move to fund: the fund does not belong to this deposit''s owner'
      using errcode = 'insufficient_privilege';
  end if;

  -- What is left to close, with the bucket precedence check_withdrawal_balance
  -- applies: a fund-keyed withdrawal draws on its (goal, fund) bucket, not on
  -- the deposit it names as parent (20260730000002).
  select v_dep.amount_vnd - coalesce(sum(w.principal_withdrawn), 0)
    into v_remaining
    from public.investment_transactions w
   where w.parent_transaction_id = p_deposit_id
     and w.transaction_type = 'withdrawal'
     and not coalesce(w.asset_type = 'fund' and w.fund_id is not null, false);
  if v_remaining <= 0 then
    raise exception 'move to fund: the deposit is already closed'
      using errcode = 'check_violation';
  end if;

  -- The same ×10 sanity bound the merge and held-settlement paths put on a
  -- client's "received" (20260620000006): a payout is principal plus interest,
  -- never a multiple of it. The purchase is that money, so an invented number
  -- here would be invented value in the goal.
  if p_received_vnd > v_remaining * 10 then
    raise exception 'move to fund: the amount received is far more than the deposit holds'
      using errcode = 'check_violation';
  end if;

  -- The purchase first, so the withdrawal can name it.
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, fund_id,
    investment_date, amount_vnd, units, unit_price, units_estimated
  ) values (
    v_dep.user_id, v_dep.goal_id, 'fund', 'investment', p_fund_id,
    v_date, p_received_vnd, p_units, p_unit_price, true
  )
  returning transaction_id into v_purchase;

  -- Closes the deposit outright: principal_withdrawn is the whole remaining
  -- principal, derived here, never the client's. affects_progress stays true —
  -- the money did leave the deposit, and the purchase brings it back to the goal.
  perform set_config('app.deposit_move_write', '1', true);
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
    investment_date, amount_vnd, principal_withdrawn, affects_progress,
    moved_to_fund_tx_id
  ) values (
    v_dep.user_id, v_dep.goal_id, 'bank', 'withdrawal', p_deposit_id,
    v_date, p_received_vnd, v_remaining, true,
    v_purchase
  )
  returning transaction_id into v_wd;
  perform set_config('app.deposit_move_write', '', true);

  return jsonb_build_object('withdrawal_id', v_wd, 'purchase_id', v_purchase);
end;
$$;

revoke all on function public.move_deposit_to_fund(uuid, bigint, uuid, numeric, numeric, date) from public, anon;
grant execute on function public.move_deposit_to_fund(uuid, bigint, uuid, numeric, numeric, date) to authenticated, service_role;
