-- A fund sale is keyed by its fund — the writer's half of the #606 decision.
--
-- #606 fixed the reader: a withdrawal parented to a fund purchase is valued against
-- that purchase's (goal, fund) bucket instead of being silently uncounted. That
-- left the invariant measuring a balance nobody draws down — it bounds such a row
-- by the parent PURCHASE's own principal, while the units come out of the BUCKET.
-- So one 50-unit purchase accepted a 45-unit fund-keyed sell and a 10-unit parented
-- sell, each legal against its own reading, 55 units out of 50; the dashboard then
-- subtracts all 55, drops the bucket at zero, and understates the holding by the
-- five units still held.
--
-- Two balances for one bucket is the bug, and this removes the second one by
-- refusing the shape as it is WRITTEN. The check goes in the immediate trigger
-- rather than in check_withdrawal_balance itself, and that placement is the whole
-- point: by the time it runs, a relocation and the FK's own orphaning have both
-- already returned, so deleting a goal or a fund still works over a ledger that
-- already contains such rows. They stay valued by the reader and reported by
-- withdrawal_ledger_audit; what stops is writing new ones.
--
-- Everything else in the function is copied verbatim from 20260730000002.

-- ── immediate: a new or increased claim ──────────────────────────────────────
create or replace function public.enforce_withdrawal_within_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The parent as the SHAPE check sees it, read under a lock (below).
  v_shape_asset text;
  v_shape_fund  uuid;
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

  -- ── a fund sale is keyed by its fund (#606) ──────────────────────────────
  -- Everything above this line has decided that the row is a NEW or RAISED claim:
  -- a relocation has already returned, and the FK's own orphaning has too. This is
  -- therefore the one place the SHAPE can be refused without refusing history.
  --
  -- Why refuse it at all: lib/withdrawalProgress values a withdrawal parented to a
  -- fund purchase against that purchase's (goal, fund) BUCKET, while
  -- check_withdrawal_balance measures it against the purchase's own principal. Two
  -- balances for one bucket — a 50-unit purchase took a 45-unit fund-keyed sell AND
  -- a 10-unit parented one, each legal against its own reading, 55 units out of 50,
  -- and the dashboard then drops the holding five units early. A fund sale carries
  -- asset_type='fund' + fund_id, which is what both sell sheets have always posted
  -- and the only shape measurable against the balance the dashboard reduces.
  --
  -- Two things it deliberately does NOT refuse:
  --   • the parent's fund must still EXIST. Deleting a fund clears fund_id on every
  --     referencing row in one statement, in no defined order, so this can run while
  --     the parent still shows the fund that is already gone; and a purchase with no
  --     fund is no bucket anyway — the reader leaves such a row on the parent axis.
  --   • a relocation. Deleting a goal (ON DELETE SET NULL) and assigning a fund both
  --     re-measure existing rows through the DEFERRED trigger, which calls
  --     check_withdrawal_balance directly and never reaches this check. A legacy row
  --     must not make a goal undeletable — it is history, valued by the reader and
  --     reported by withdrawal_ledger_audit. What stops is writing new ones.
  -- "not fund-keyed", spelled with the parens it needs: asset_type is nullable, so
  -- the fund branch requires BOTH asset_type='fund' and a fund_id.
  if new.parent_transaction_id is not null
     and (new.asset_type is distinct from 'fund' or new.fund_id is null) then
    -- LOCKED, for the same reason every other measurement here is (see the header
    -- of 20260730000002): read unlocked, this races the very edit that creates the
    -- shape. A conversion of the parent bank → fund running concurrently with this
    -- insert saw no child yet, while this saw the parent's old bank version — and
    -- then check_withdrawal_balance locked the parent, waited for that conversion,
    -- and measured the row against a fund purchase whose shape had just been
    -- waved through. Taking the lock here makes the two serialize whichever wins:
    -- this statement re-reads the committed parent and refuses, or the conversion
    -- waits and finds the child.
    select p.asset_type, p.fund_id
      into v_shape_asset, v_shape_fund
      from public.investment_transactions p
     where p.transaction_id = new.parent_transaction_id
       and p.user_id = new.user_id
       and p.transaction_type = 'investment'
       for update;

    if v_shape_asset = 'fund' and v_shape_fund is not null
       and exists (select 1 from public.funds f where f.id = v_shape_fund) then
      raise exception 'withdrawal invariant: a fund sale must be keyed by its fund (asset_type=fund + fund_id), not parented to purchase %',
        new.parent_transaction_id using errcode = 'check_violation';
    end if;
  end if;

  perform public.check_withdrawal_balance(new);
  return new;
end;
$$;

comment on function public.enforce_withdrawal_within_balance() is
  'Measures a new or increased withdrawal claim against its holding as it is written (#587).';

