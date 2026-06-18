-- Fix: collapse_accumulating_book must not silently drop a recurring saving's
-- EXPLICIT deposit link (#348) when it deletes a tranche.
--
-- recurring_savings.linked_deposit_tx_id (migration 20260616000003) references
-- investment_transactions ON DELETE SET NULL. A user can legitimately link a
-- recurring saving to a specific top-up tranche. The original collapse RPC
-- deletes every non-anchor tranche, so such a link would be SET NULL out from
-- under the user — and inconsistently: a link to the anchor tranche survives
-- (the anchor is rolled forward, not deleted) while a link to any other tranche
-- vanishes, with no notice.
--
-- The collapse leaves exactly one surviving deposit (the rolled-forward anchor =
-- p_group_id), which is the natural new target: the lump inherits the link so the
-- EXPLICIT match tier still resolves it next cycle. So before deleting any
-- tranche, re-point every recurring link that points at ANY of the book's
-- tranches onto the anchor. (Re-pointing a link already on the anchor is a no-op.)
--
-- Body is otherwise identical to 20260618000001 — see it for the full rationale on
-- the coupled, atomic writes.
create or replace function public.collapse_accumulating_book(
  p_group_id uuid,
  p_amount_vnd bigint,
  p_interest_rate numeric,
  p_expiry_date date,
  p_investment_date date,
  p_tranche_ids uuid[],
  p_tranche_interest bigint[],
  p_fulfill_saving_id uuid default null,
  p_fulfill_ym text default null,
  p_fulfill_amount bigint default null,
  p_fulfill_source text default null
)
returns public.investment_transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_anchor public.investment_transactions;
  v_tranche public.investment_transactions;
  v_snapshot_id uuid;
  v_interest bigint;
  v_idx int;
  v_renewed public.investment_transactions;
begin
  select * into v_anchor
    from public.investment_transactions
   where transaction_id = p_group_id
     and deposit_group_id = p_group_id
   for update;
  if not found then
    raise exception 'collapse_accumulating_book: accumulating book not found'
      using errcode = 'no_data_found';
  end if;
  if v_anchor.asset_type is distinct from 'bank' then
    raise exception 'collapse_accumulating_book: only bank books can be collapsed'
      using errcode = 'check_violation';
  end if;
  if p_amount_vnd is null or p_amount_vnd <= 0 then
    raise exception 'collapse_accumulating_book: amount must be positive'
      using errcode = 'check_violation';
  end if;
  if p_investment_date > current_date + 1 then
    raise exception 'collapse_accumulating_book: investment date cannot be in the future'
      using errcode = 'check_violation';
  end if;
  if p_expiry_date is not null and p_expiry_date <= p_investment_date then
    raise exception 'collapse_accumulating_book: new maturity must be after the investment date'
      using errcode = 'check_violation';
  end if;

  -- 0) Preserve EXPLICIT recurring links (#348): re-point any link that targets a
  -- tranche of this book onto the surviving anchor BEFORE the deletes below, so
  -- the FK's ON DELETE SET NULL never fires on a still-wanted link.
  update public.recurring_savings
     set linked_deposit_tx_id = p_group_id,
         updated_at = now()
   where user_id = v_anchor.user_id
     and linked_deposit_tx_id in (
       select transaction_id from public.investment_transactions
        where deposit_group_id = p_group_id
          and transaction_type = 'investment'
          and renewed_from_transaction_id is null
     );

  -- 1–4) Snapshot, re-parent, then delete every tranche; roll the anchor forward
  -- after the loop.
  for v_tranche in
    select * from public.investment_transactions
     where deposit_group_id = p_group_id
       and transaction_type = 'investment'
       and renewed_from_transaction_id is null
     order by investment_date
     for update
  loop
    v_idx := array_position(p_tranche_ids, v_tranche.transaction_id);
    v_interest := case when v_idx is null then null else p_tranche_interest[v_idx] end;

    insert into public.investment_transactions (
      user_id, goal_id, asset_type, transaction_type, amount_vnd,
      investment_date, expiry_date, interest_rate, notes,
      renewed_from_transaction_id, interest_earned_vnd, affects_progress
    ) values (
      v_tranche.user_id, v_tranche.goal_id, 'bank', 'investment', v_tranche.amount_vnd,
      v_tranche.investment_date, v_tranche.expiry_date, v_tranche.interest_rate, v_tranche.notes,
      p_group_id, v_interest, false
    )
    returning transaction_id into v_snapshot_id;

    update public.investment_transactions
       set parent_transaction_id = v_snapshot_id
     where parent_transaction_id = v_tranche.transaction_id
       and transaction_type = 'withdrawal';

    if v_tranche.transaction_id <> p_group_id then
      delete from public.investment_transactions
       where transaction_id = v_tranche.transaction_id;
    end if;
  end loop;

  update public.investment_transactions
     set amount_vnd        = p_amount_vnd,
         interest_rate     = p_interest_rate,
         expiry_date       = p_expiry_date,
         investment_date   = p_investment_date,
         deposit_group_id  = null,
         updated_at        = now()
   where transaction_id = p_group_id
  returning * into v_renewed;

  if p_fulfill_saving_id is not null and p_fulfill_ym is not null then
    if not exists (
      select 1 from public.recurring_savings
       where saving_id = p_fulfill_saving_id and user_id = v_anchor.user_id
    ) then
      raise exception 'collapse_accumulating_book: recurring saving not found'
        using errcode = 'no_data_found';
    end if;
    insert into public.recurring_saving_fulfillments (
      user_id, recurring_saving_id, ym, amount_vnd, source
    ) values (
      v_anchor.user_id, p_fulfill_saving_id, p_fulfill_ym,
      coalesce(p_fulfill_amount, 0), coalesce(p_fulfill_source, 'maturity-collapse')
    )
    on conflict (recurring_saving_id, ym) do update
      set amount_vnd = excluded.amount_vnd,
          source     = excluded.source,
          updated_at = now();
  end if;

  return v_renewed;
end;
$$;
