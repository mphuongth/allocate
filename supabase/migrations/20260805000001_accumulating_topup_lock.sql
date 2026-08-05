-- Store a product-specific pre-maturity top-up lock on accumulating books (#638).
alter table public.investment_transactions
  add column if not exists top_up_lock_days integer;

alter table public.investment_transactions
  add constraint investment_transactions_top_up_lock_days_check
  check (top_up_lock_days is null or (top_up_lock_days >= 0 and top_up_lock_days <= 3650));

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
    -- Include NEW.user_id in the SECURITY DEFINER lookup. This must happen
    -- before reading a locked anchor so a foreign book cannot reveal its
    -- maturity or lock window through the resulting error.
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
