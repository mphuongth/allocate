-- Replay the withdrawal ledger in write order, and name the first row that could
-- not have been written at its turn (#613).
--
-- 20260730000003 screens the ledger as it STANDS, and its header states the limit
-- that no extra predicate can remove:
--
--   The invariant is STATEFUL. It measures each write against the balance
--   remaining at that moment, so whether a row was legal depends on the order the
--   rows were written in. Different histories — some legal, some not — reach the
--   very same final state, and the state does not record which one happened.
--
-- The sharpest case, and the one this file exists for: 1000 đồng over 100 units,
-- two sales of 50 units taking 497 and 503. Neither can be written first (50 of
-- 100 units must take 500) and neither can follow the other, yet the totals are
-- exactly proportional and each per-sale deviation is inside what a LEGAL two-sale
-- ledger shows on other holdings. No predicate over the final state separates it,
-- so the screen is silent — correctly, and a test pins that silence.
--
-- The order the screen lacks is recorded: created_at. So this replays it. Each
-- balance key's rows are put back in write order and the invariant's own
-- transition rules are re-run over them, carrying remaining principal and
-- remaining units forward. Sharp answers, no tolerance-guessing — the epsilons
-- below are the invariant's own two constants and nothing else.
--
-- ─── Why this could not ship before #608 ─────────────────────────────────────
--
-- A replay reconstructs history from rows as they are NOW. If a source's
-- amount_vnd or units was edited after a sale drew on it, every later step is
-- measured against a balance that never existed and the audit produces confident,
-- wrong answers — worse than the screen's honest silence. #608 (20260804000001)
-- refuses the edits that would make a ledger insolvent, which is what makes a
-- replay worth running at all.
--
-- It does not make every replay sound, and this file does not pretend it does.
-- #608 bounds the TOTAL a source owes, not each prefix of it: a gold holding of
-- 1000 đồng / 100 units with one 50-unit sale taking 500 can still be re-priced
-- down to 600, and the replay then measures a perfectly legal sale against a basis
-- it never saw. Same for a fund purchase relocated into or out of a bucket, and
-- for a withdrawal whose own amounts were later corrected — the row's numbers are
-- no longer what was measured at its turn.
--
-- So the premise is TESTED rather than assumed, per key: a row is `touched` when
-- its updated_at is later than its created_at, which every write path in the app
-- maintains (an insert leaves them equal — both default to now() — and the PUT
-- route, the assign route and every RPC set updated_at explicitly). A key whose
-- rows are all pristine can be replayed exactly, and a finding there is a
-- 'violation': no ordering of these rows produces it. A key with any touched row
-- reports 'review' instead, the same vocabulary the screen uses and for the same
-- reason — the number is worth looking at, the proof is not available.
--
-- That is also how the RPC rewrites the issue asks about are handled, and it needs
-- no catalogue of them. renew_term_deposit_with_merge re-parents partial
-- withdrawals onto the history snapshot it just wrote; collapse and the book
-- top-up rewrite amounts mid-transaction. Every one of those bumps updated_at on
-- the rows it touches, so the keys they produce carry their findings as 'review'
-- by construction, rather than being flagged as corruption or having their shapes
-- hand-listed here — a list that would go stale the first time an RPC changed.
--
-- The second thing a 'violation' has to answer for is that the order it replayed
-- is the only one the ledger allows. now() is transaction-stable, so every row a
-- single RPC writes shares one created_at exactly, and transaction_id is a random
-- uuid — sorting by it invents an order rather than recovering one. An instant
-- holding more than one event, at least one of them a claim, therefore drops
-- everything from that point on to 'review' as well. See the `tied` CTE for the
-- legal pair that fails when its two rows are replayed the other way round.
--
-- Two residual gaps, stated rather than papered over. updated_at is maintained by
-- the writers, not by a trigger, so a hand-written SQL UPDATE that leaves it alone
-- is invisible to this test and its key would still read as pristine. And the test
-- can only see rows that are STILL on the key: a purchase relocated OUT of a fund
-- bucket carries its touched flag away with it, so a bucket left short by a
-- relocation reads as pristine and its sells are reported as violations. That is
-- the same verdict withdrawal_ledger_audit's fund_bucket_has_no_purchases already
-- gives that state (#610), so the two agree — but the proof here is the weaker one.
--
-- ─── What the replay does NOT judge ──────────────────────────────────────────
--
-- Only the balance transitions — how much was left, and what a sale was allowed to
-- take from it. The SHAPE checks (negative amounts, a fund sell with no units, a
-- parent that is not an investment, a row drawing on no holding at all) are
-- decidable from state alone and belong to withdrawal_ledger_audit, which already
-- reports them as violations. Reporting them twice would double the noise without
-- adding a fact. The two views are complements: run the screen for shapes and
-- aggregates, run this for sequences.
--
-- Only the FIRST failing row per balance key is reported. Once a row could not
-- have been written, the state every later row is measured against is fiction, so
-- the rows after it are not evidence of anything — the detail says how many there
-- are and stops.
--
-- Read-only. It names rows and holdings, changes nothing, and is safe to run on
-- production in the SQL editor:
--
--   select check_name, severity, count(*)
--     from public.withdrawal_ledger_replay
--    group by 1, 2 order by 2, 1;
--
-- Its columns match public.withdrawal_ledger_audit's, so the two can be read side
-- by side or unioned.
--
-- Why a view and not a script in a folder, and why a test that plants ledgers the
-- invariant refuses to write: the same reason 20260730000003 gives. An audit that
-- returns nothing is indistinguishable from an audit that looks for nothing, and
-- the only way to keep it honest is to make it a database object a test can query.
-- supabase/tests/withdrawal_ledger_replay.test.sql asserts of every catch that
-- withdrawal_ledger_audit is SILENT on the same fixture, so the day this decays
-- into a restatement of that view, the suite says so.

create or replace view public.withdrawal_ledger_replay
with (security_invoker = true) as
with wd as (
  select w.transaction_id, w.user_id, w.goal_id, w.fund_id, w.parent_transaction_id,
         w.principal_withdrawn, w.units_withdrawn, w.created_at, w.updated_at,
         -- The same branch precedence as check_withdrawal_balance and
         -- lib/withdrawalProgress: asset_type='fund' + fund_id wins, and such a row
         -- draws on its (goal, fund) bucket whatever parent it also names.
         coalesce(w.asset_type = 'fund' and w.fund_id is not null, false) as fund_keyed
    from public.investment_transactions w
   where w.transaction_type = 'withdrawal'
),

-- ── the ledger as a sequence of events, per balance key ──────────────────────
-- Two kinds of key, exactly the two the invariant resolves to:
--   'p:<id>'          one source row — bank, gold, stock
--   'f:<fund>:<goal>' a fund bucket, which a sell draws on with no parent at all
--
-- A credit adds to the balance, a debit takes from it, and the running sum of
-- everything BEFORE a debit is the state that debit was measured against.
events as (
  -- The opening balance of a parent-backed holding. Sorted at -infinity rather
  -- than at its own created_at, because a source is not an event in its holding's
  -- history — check_withdrawal_balance reads its amount_vnd and units wholesale,
  -- with no interleaving, and every claim parented to it is measured against that.
  -- Ordering it by created_at would also invert the one case that matters: renewal
  -- re-parents a deposit's partial withdrawals onto a history snapshot written
  -- AFTER them (#585), so the source would sort last and every legal claim on it
  -- would replay against an empty holding.
  select p.user_id,
         'p:' || p.transaction_id::text        as balance_key,
         p.transaction_id                      as holding,
         null::uuid                            as fund_id,
         p.goal_id                             as goal_id,
         -- Gold is the one non-fund holding valued by QUANTITY, so its sales follow
         -- the proportional allocation rather than the outright principal cap.
         (p.asset_type = 'gold')               as quantity_valued,
         '-infinity'::timestamptz              as ord_at,
         0                                     as ord_kind,
         p.transaction_id                      as ord_id,
         false                                 as is_debit,
         false                                 as judge_here,
         null::uuid                            as row_id,
         coalesce(p.amount_vnd, 0)::numeric    as d_basis,
         coalesce(p.units, 0)::numeric         as d_units,
         null::numeric                         as took_principal,
         null::numeric                         as took_units,
         (p.updated_at > p.created_at)         as touched
    from public.investment_transactions p
   where p.transaction_type = 'investment'
     and exists (select 1 from wd w
                  where w.parent_transaction_id = p.transaction_id and not w.fund_keyed)

  union all
  select w.user_id, 'p:' || w.parent_transaction_id::text, w.parent_transaction_id, null, w.goal_id,
         (pa.asset_type = 'gold'),
         w.created_at, 1, w.transaction_id, true, true, w.transaction_id,
         -coalesce(w.principal_withdrawn, 0), -coalesce(w.units_withdrawn, 0),
         coalesce(w.principal_withdrawn, 0), coalesce(w.units_withdrawn, 0),
         (w.updated_at > w.created_at)
    from wd w
    join public.investment_transactions pa on pa.transaction_id = w.parent_transaction_id
   where not w.fund_keyed
     -- A parent that is not an investment invents a balance out of money that
     -- already left; withdrawal_ledger_audit calls that by name, and replaying it
     -- would only restate the same row less clearly.
     and pa.transaction_type = 'investment'

  union all
  -- The bucket's OTHER kind of claim (#606). A withdrawal parented to a fund
  -- PURCHASE is not fund-keyed, so it is measured on the parent axis above — but
  -- 20260803000005 also charges it against that purchase's (goal, fund) bucket
  -- when the next sale is measured, because lib/withdrawalProgress values it
  -- there. Leaving it out of the bucket made the replay miss exactly the overdraw
  -- that migration exists to refuse: a legacy 10-unit claim on a 50-unit purchase
  -- followed by a 45-unit sell replays as 45 of 50 and reports clean.
  --
  -- It is a DEBIT here and not a judged one: the invariant never measures such a
  -- row against the bucket, only counts it. Its verdict is the parent axis's.
  --
  -- Every predicate below is that function's, including the derived units for a
  -- claim that records none, and `p.units > 0` — a purchase with no units is no
  -- bucket, so its claim stays on the parent axis alone.
  select w.user_id,
         'f:' || p.fund_id::text || ':' || coalesce(p.goal_id::text, ''),
         null, p.fund_id, p.goal_id, true,
         w.created_at, 1, w.transaction_id, true, false, w.transaction_id,
         -coalesce(w.principal_withdrawn, 0),
         -case when coalesce(w.units_withdrawn, 0) > 0 then w.units_withdrawn
               else least(p.units, p.units * coalesce(w.principal_withdrawn, 0) / p.amount_vnd) end,
         null, null,
         (w.updated_at > w.created_at)
    from wd w
    join public.investment_transactions p on p.transaction_id = w.parent_transaction_id
   where not w.fund_keyed
     and p.transaction_type = 'investment'
     and p.asset_type = 'fund'
     and p.fund_id is not null
     and coalesce(p.units, 0) > 0
     and coalesce(p.amount_vnd, 0) > 0

  union all
  -- A fund bucket's purchases DO interleave: the invariant sums whatever is in the
  -- bucket at the moment of the sell, so a purchase made later is not part of that
  -- sum. The exclusions mirror the invariant's own — a pending DCA seed (units
  -- null) holds nothing sellable, and a renewal snapshot is a history copy.
  select t.user_id,
         'f:' || t.fund_id::text || ':' || coalesce(t.goal_id::text, ''),
         null, t.fund_id, t.goal_id, true,
         t.created_at, 0, t.transaction_id, false, false, t.transaction_id,
         coalesce(t.amount_vnd, 0), coalesce(t.units, 0), null, null,
         (t.updated_at > t.created_at)
    from public.investment_transactions t
   where t.transaction_type = 'investment'
     and t.asset_type = 'fund'
     and t.fund_id is not null
     and t.units is not null
     and t.renewed_from_transaction_id is null

  union all
  select w.user_id,
         'f:' || w.fund_id::text || ':' || coalesce(w.goal_id::text, ''),
         null, w.fund_id, w.goal_id, true,
         w.created_at, 1, w.transaction_id, true, true, w.transaction_id,
         -coalesce(w.principal_withdrawn, 0), -coalesce(w.units_withdrawn, 0),
         coalesce(w.principal_withdrawn, 0), coalesce(w.units_withdrawn, 0),
         (w.updated_at > w.created_at)
    from wd w
   where w.fund_keyed
),

-- ── the state each row was written against ──────────────────────────────────
-- now() is fixed for a whole transaction, so every row a single RPC writes shares
-- one created_at and there is no order between them to read. Credits are therefore
-- sorted before debits at the same instant, which is the only reading under which
-- such a transaction could have passed the invariant in the first place: a
-- purchase and the sell of it written together must have gone in that order.
--
-- Ties are the limit of that reading, and they are load-bearing. Two withdrawals
-- written by separate statements of ONE transaction share a created_at exactly,
-- and transaction_id is a random uuid — it recovers no order, it only invents a
-- stable one. A pristine, legal ledger can fail under the invented order: against
-- 1000 đồng / 100 units, (34 units, 339 đồng) then (32 units, 319 đồng) is legal
-- both ways round as written, but replayed in the other order the 34-unit row owes
-- 341 and is two đồng out. So an instant holding more than one event, at least one
-- of them a debit, makes every finding from that point on a 'review' — the replay
-- still says what it found and against what, it just does not claim the ordering
-- was the one that happened.
tied as (
  select e.*,
         (count(*) over w_at > 1 and count(*) filter (where e.is_debit) over w_at > 0)
           as ambiguous_instant
    from events e
  window w_at as (partition by e.user_id, e.balance_key, e.ord_at)
),
state as (
  select t.*,
         coalesce(sum(t.d_basis) over w_prev, 0) as rem_basis,
         coalesce(sum(t.d_units) over w_prev, 0) as rem_units,
         bool_or(t.touched)      over w_key      as key_touched,
         count(*) filter (where t.is_debit) over w_key as claims_on_key,
         -- Where this claim sits in the holding's history, which is the number an
         -- operator needs to find it in the ledger. Counted over the claims alone,
         -- so an interleaved fund purchase does not shift it.
         count(*) filter (where t.is_debit) over w_upto as claim_ordinal,
         -- Only ties up to and including this row can have moved the balance it was
         -- measured against; a tie later in the holding says nothing about it.
         bool_or(t.ambiguous_instant) over w_upto as order_ambiguous
    from tied t
  window
    w_key  as (partition by t.user_id, t.balance_key),
    w_prev as (partition by t.user_id, t.balance_key
               order by t.ord_at, t.ord_kind, t.ord_id
               rows between unbounded preceding and 1 preceding),
    w_upto as (partition by t.user_id, t.balance_key
               order by t.ord_at, t.ord_kind, t.ord_id
               rows between unbounded preceding and current row)
),

-- ── the invariant's own transition rules, re-run ────────────────────────────
-- Same three questions check_withdrawal_balance asks, same two constants, asked of
-- the balance as it stood rather than of the balance as it ended.
judged as (
  select s.*,
         case when s.rem_units > 0 and s.took_units < s.rem_units - 0.0001
                then round(s.took_units * s.rem_basis / s.rem_units)
              else s.rem_basis end as owed,
         case
           -- Quantity, for whichever kinds carry units. The epsilon rounds a real
           -- balance and does not create one, so an emptied holding is measured
           -- exactly — `case when v_left_units > 0` is the invariant's own wording.
           when s.took_units > 0
            and s.took_units > s.rem_units + case when s.rem_units > 0 then 0.0001 else 0 end
             then 'sale_exceeded_the_units_left'
           -- A quantity-valued holding binds its principal TO the units: a sale of
           -- all that is left takes the remaining basis, a partial sale its
           -- units-proportional share, and the two sides may differ by at most the
           -- đồng that rounding a slice produces.
           when s.quantity_valued and s.took_units > 0 and s.rem_units > 0
            and abs(s.took_principal
                    - case when s.took_units < s.rem_units - 0.0001
                             then round(s.took_units * s.rem_basis / s.rem_units)
                           else s.rem_basis end) > 1
             then 'sale_took_the_wrong_basis'
           -- Bank and stock: the principal is the user's own figure, capped
           -- outright by what the holding still held.
           when not s.quantity_valued and s.took_principal > 0
            and s.took_principal > s.rem_basis
             then 'withdrawal_exceeded_the_balance'
         end as failure
    from state s
   where s.judge_here
),

fails as (
  select j.*, count(*) over (partition by j.user_id, j.balance_key) as fails_on_key
    from judged j
   where j.failure is not null
)

select distinct on (f.user_id, f.balance_key)
       f.failure::text  as check_name,
       -- Provable only where the replay's premise holds: nothing on this key was
       -- touched after it was written, and no instant up to this row holds two
       -- events whose order the ledger does not record. Then these rows ARE the
       -- history, and no ordering of them produces what was found.
       case when f.key_touched or f.order_ambiguous then 'review' else 'violation' end::text as severity,
       f.user_id,
       f.row_id         as transaction_id,
       f.holding        as parent_transaction_id,
       f.fund_id,
       f.goal_id,
       case f.failure
         when 'sale_exceeded_the_units_left' then
           -- "claim(s)", not "sale(s)": on a fund bucket this count includes the
           -- withdrawals parented to its purchases (#606), which are claims on the
           -- bucket without being sales of it. Counting them is the point — a
           -- legacy claim is often the reason the sale that follows does not fit,
           -- and an operator who cannot see it in the tally goes looking for a
           -- second sale that is not there.
           format('a sale of %s units when the holding had %s units left (%s đồng of basis), %s of %s claim(s) into its history',
                  f.took_units, f.rem_units, f.rem_basis, f.claim_ordinal, f.claims_on_key)
         when 'sale_took_the_wrong_basis' then
           format('a sale of %s units out of the %s units then left, against a %s đồng basis: it should have taken %s đồng, it took %s',
                  f.took_units, f.rem_units, f.rem_basis, f.owed, f.took_principal)
         else
           -- This branch is the parent axis alone, where every claim IS a
           -- withdrawal of the holding and the word can be the exact one.
           format('a withdrawal of %s đồng when the holding had %s đồng left, %s of %s withdrawal(s) into its history',
                  f.took_principal, f.rem_basis, f.claim_ordinal, f.claims_on_key)
       end
       || case when f.fails_on_key > 1
                 then format(' — and %s later row(s) on this holding fail the replay too, measured against a balance this one already made fiction',
                             f.fails_on_key - 1)
               else '' end as detail
  from fails f
 order by f.user_id, f.balance_key, f.ord_at, f.ord_kind, f.ord_id;

comment on view public.withdrawal_ledger_replay is
  'Replays each balance key''s rows in created_at order against check_withdrawal_balance''s own transition rules and names the first row that could not have been written at its turn. severity=violation where every row on the key is pristine (updated_at = created_at), so the replay IS the history; severity=review where something was touched afterwards. Shape checks belong to withdrawal_ledger_audit (#613).';

-- An operator tool, and there is no screen that reads it. security_invoker means
-- RLS would confine a caller to their own rows anyway, but granting it adds a
-- PostgREST surface for no gain — the same reasoning that revoked
-- withdrawal_ledger_audit in 20260730000003.
revoke all on public.withdrawal_ledger_replay from anon, authenticated;
