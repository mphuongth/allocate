-- Store a product-specific pre-maturity top-up lock on accumulating books (#638).
alter table public.investment_transactions
  add column if not exists top_up_lock_days integer;

alter table public.investment_transactions
  add constraint investment_transactions_top_up_lock_days_check
  check (top_up_lock_days is null or (top_up_lock_days >= 0 and top_up_lock_days <= 3650));

-- The lock window is deposit terms, so it joins the rest of them in the subtype
-- shape (#593): a fund/gold/stock row may not carry it, and a bank -> gold edit
-- clears it with the others (lib/assetTypeFields.ts nulls the whole exclusive
-- set). Restated in full rather than patched, because a CHECK cannot be altered
-- in place — this is 20260802000001's constraint plus one column.
alter table public.investment_transactions
  drop constraint if exists investment_transactions_subtype_shape;

alter table public.investment_transactions
  add constraint investment_transactions_subtype_shape check (
    transaction_type <> 'investment'
    or asset_type is null
    or case asset_type
         when 'bank' then
           fund_id is null and units is null and unit_price is null
         when 'fund' then
           interest_rate is null and expiry_date is null and bank_code is null
           and interest_earned_vnd is null and deposit_group_id is null
           and top_up_lock_days is null
         when 'gold' then
           fund_id is null and interest_rate is null and expiry_date is null
           and bank_code is null and interest_earned_vnd is null and deposit_group_id is null
           and top_up_lock_days is null
         when 'stock' then
           fund_id is null and interest_rate is null and expiry_date is null
           and bank_code is null and interest_earned_vnd is null and deposit_group_id is null
           and top_up_lock_days is null
         else true
       end
  );

comment on constraint investment_transactions_subtype_shape on public.investment_transactions is
  'An investment row carries only its own asset type''s fields (#593, #638). See lib/assetTypeFields.ts for the same table in application code.';

create or replace function public.assert_accumulating_book_topup_allowed(p_book_id uuid, p_owner_id uuid, p_top_up_date date)
returns void language plpgsql security definer set search_path = '' as $$
declare v_anchor public.investment_transactions; v_days_left integer;
begin
  select * into v_anchor from public.investment_transactions
   where transaction_id = p_book_id and deposit_group_id = p_book_id and user_id = p_owner_id for update;
  if not found then raise exception 'accumulating top-up: accumulating book not found' using errcode = 'no_data_found'; end if;
  if v_anchor.expiry_date is null then return; end if;
  v_days_left := v_anchor.expiry_date - p_top_up_date;
  if v_days_left <= 0 then
    raise exception 'accumulating top-up: cannot top up a deposit on or after its maturity date' using errcode = 'check_violation';
  end if;
  if v_anchor.top_up_lock_days is not null and v_days_left <= v_anchor.top_up_lock_days then
    raise exception 'accumulating top-up: this deposit no longer accepts top-ups: % days remain before maturity (its lock window is % days)', v_days_left, v_anchor.top_up_lock_days using errcode = 'check_violation';
  end if;
end;
$$;

revoke all on function public.assert_accumulating_book_topup_allowed(uuid, uuid, date) from public, anon, authenticated;

create or replace function public.enforce_accumulating_book_topup_lock()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.transaction_type = 'investment'
     and new.deposit_group_id is not null
     and new.transaction_id <> new.deposit_group_id
     and (tg_op = 'INSERT'
       or old.deposit_group_id is distinct from new.deposit_group_id
       or old.investment_date is distinct from new.investment_date
       -- A row that BECOMES an investment is a new tranche as far as the book is
       -- concerned. Without this, a booked row could be turned into a withdrawal
       -- (which this trigger skips), redated inside the lock window, and turned
       -- back — the last step changing no other tracked column.
       or old.transaction_type is distinct from new.transaction_type) then
    -- NEW.user_id scopes the SECURITY DEFINER lookup so a book owned by someone
    -- else answers "not found" instead of reporting its maturity and lock window.
    -- But an authenticated caller writes NEW.user_id themselves, and the RLS
    -- WITH CHECK that refuses a foreign owner runs AFTER before-row triggers —
    -- so naming the owner would otherwise buy the same answer. Say nothing about
    -- a row this caller will not own and let RLS refuse it. auth.uid() is null
    -- for the service role and for SQL writers, which still get the backstop.
    if auth.uid() is not null and new.user_id is distinct from auth.uid() then
      return new;
    end if;
    perform public.assert_accumulating_book_topup_allowed(new.deposit_group_id, new.user_id, new.investment_date);
  end if;
  return new;
end;
$$;

drop trigger if exists investment_transactions_accumulating_topup_lock on public.investment_transactions;
create trigger investment_transactions_accumulating_topup_lock
  before insert or update of deposit_group_id, investment_date, transaction_type on public.investment_transactions
  for each row
  execute function public.enforce_accumulating_book_topup_lock();
