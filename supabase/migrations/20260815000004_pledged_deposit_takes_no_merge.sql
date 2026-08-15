-- A pledged deposit takes no merge (#635).
--
-- "Not pledged" is rule 5 of the merge ruleset, and it guarded one side only.
-- lib/mergeEligibility read `source.isPledged` and nothing ever read the
-- ANCHOR's, so the rule blocked LIQUIDATING collateral into a merge and said
-- nothing about ADDING cash to collateral. Downstream nothing closed it either:
-- holdAnchorsFor calls the same predicate with the roles reversed, so a pledged
-- later sibling was offered as the deposit to park cash for; the resolve sheet
-- passes the maturing deposit's is_pledged and no rule read it; and no merge RPC
-- mentions is_pledged at all — held_settlement_source_state guards the SOURCE,
-- which is the half that already worked.
--
-- The product decision on #635 was the symmetric block: cash must not be folded
-- into a deposit frozen as collateral. It would land inside a balance the user
-- cannot withdraw until the pledge is released, and nothing in the flow told
-- them — while the "Bộ luật" card presents "not pledged" as a property of the
-- merge, not of one side of it. Topping up collateral stays possible; it just
-- has to be deliberate: release the pledge, merge, pledge again.
--
-- The UI half lives in lib/mergeEligibility. This is the same rule for the raw
-- API, which reaches these rows directly.
--
-- ── where the rule lives, and why not in the RPCs ────────────────────────────
--
-- Every merge into a destination D writes D's id into one of two columns:
--
--   • consumed_by_inv_id, on the withdrawal a live source's closure produces and
--     on the held settlement a consume folds in — renew_term_deposit_with_merge
--     stamps both;
--   • merge_anchor_inv_id, on a settlement that is WAITING for D.
--
-- So the columns are the choke point, and a trigger on them covers every writer
-- — including the two merge RPCs — without recreating a 280-line function to
-- add one check. That matters here beyond taste: renew_term_deposit_with_merge
-- has been copied five times, and a copy whose next edit does not reach it is
-- how #616's fund-bucket bug happened.
--
-- The anchor is refused up front rather than at merge time. Cash earmarked to a
-- deposit that may not receive it is stranded until someone notices, and the
-- sheet no longer offers that anchor anyway.
--
-- ── the message prefixes are load-bearing ────────────────────────────────────
--
-- Each refusal carries the prefix the route that can reach it already
-- translates, so the user gets a sentence rather than a 500:
--
--   • 'held settlement: …' — POST /api/v1/investment-transactions maps this
--     family to a 400 naming the rule (the #588 plumbing);
--   • 'pledged deposit: …' — the renew route maps this one to a 409, added in
--     the same change. Everything else it gets is still a 500, which is what a
--     fault should be.
--
-- Pledging a deposit that ALREADY has cash earmarked to it is not guarded here.
-- It is the same question from the other end and the answer is less obvious (the
-- pledge is a fact about the bank account, not a claim about the app's state);
-- the merge simply refuses later, with the message naming the remedy.
create or replace function public.enforce_pledged_deposit_takes_no_merge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pledged boolean;
begin
  -- The destination of a completed merge.
  if new.consumed_by_inv_id is not null
     and (tg_op = 'INSERT' or old.consumed_by_inv_id is distinct from new.consumed_by_inv_id) then
    select coalesce(t.is_pledged, false) into v_pledged
      from public.investment_transactions t
     where t.transaction_id = new.consumed_by_inv_id;
    if v_pledged then
      raise exception 'pledged deposit: this deposit is pledged as collateral, so money cannot be merged into it — release the pledge first'
        using errcode = 'check_violation';
    end if;
  end if;

  -- The destination a parked settlement is waiting for.
  if new.merge_anchor_inv_id is not null
     and (tg_op = 'INSERT' or old.merge_anchor_inv_id is distinct from new.merge_anchor_inv_id) then
    select coalesce(t.is_pledged, false) into v_pledged
      from public.investment_transactions t
     where t.transaction_id = new.merge_anchor_inv_id;
    if v_pledged then
      raise exception 'held settlement: the deposit this cash is waiting for is pledged as collateral — release the pledge first'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_pledged_deposit_takes_no_merge() from public, anon, authenticated;

drop trigger if exists investment_transactions_pledged_takes_no_merge on public.investment_transactions;
-- `of <columns>` rather than every update: naming one of them is the only way to
-- point a merge at a deposit, so a narrower trigger cannot be dodged, and rows
-- that carry neither are not re-checked on every unrelated edit.
create trigger investment_transactions_pledged_takes_no_merge
  before insert or update of consumed_by_inv_id, merge_anchor_inv_id
  on public.investment_transactions
  for each row
  execute function public.enforce_pledged_deposit_takes_no_merge();

comment on function public.enforce_pledged_deposit_takes_no_merge() is
  'Cash cannot be folded into a deposit frozen as collateral, from either column that names a merge destination (#635).';
