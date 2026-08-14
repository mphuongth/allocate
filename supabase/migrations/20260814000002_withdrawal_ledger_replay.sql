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
-- The second thing a 'violation' has to answer for is the ORDER, and created_at
-- cannot answer it. It defaults to now(), which is the transaction's START, while
-- the invariant serializes claims on the source's row lock — so the write order is
-- the lock order, and a long-running transaction writes after a later-starting
-- one. Reproduced with two sessions: A begins at 11:06:57 and writes (32 units,
-- 319 đồng); B begins at 11:06:59, writes (34, 339) and commits first. Both are
-- accepted, both rows are pristine, and created_at puts them in the wrong order —
-- replayed that way the 34-unit row owes 341 and is two đồng out. Rows a single
-- RPC writes are worse still: they share one created_at exactly and transaction_id
-- is a random uuid, which invents an order rather than recovering one.
--
-- So the ordering is not assumed AT ALL. created_at decides what the finding is
-- reported against; what it is PROVED against is the question #613 actually asks —
-- no ordering of any history could have produced this row — answered by searching
-- for a legal one. See the `reach` CTE: it is a subset search rather than a
-- permutation one, because the balance after a set of events does not depend on
-- the order they arrived in. A key with a legal reading is 'review' however
-- damning the created_at order looks, and the finding is reported either way.
--
-- The price is real and worth stating plainly: a fund bucket whose purchases could
-- be reordered ahead of its sells is rarely provable, because "all the purchases
-- first" is usually a legal reading. Those report 'review'. What stays provable is
-- the class #613 opens with — a holding no sequence explains, like the 497/503
-- pair — and any holding whose claims exceed it outright.
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
-- RECURSIVE for the `reach` CTE alone, which walks the subsets of a key's events.
with recursive wd as (
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
-- That order is what the replay REPORTS against. It is not what it proves from —
-- see the ordering search below, which assumes no order at all.
state as (
  select e.*,
         coalesce(sum(e.d_basis) over w_prev, 0) as rem_basis,
         coalesce(sum(e.d_units) over w_prev, 0) as rem_units,
         bool_or(e.touched)      over w_key      as key_touched,
         count(*) filter (where e.is_debit) over w_key as claims_on_key,
         -- Where this claim sits in the holding's history, which is the number an
         -- operator needs to find it in the ledger. Counted over the claims alone,
         -- so an interleaved fund purchase does not shift it.
         count(*) filter (where e.is_debit) over w_upto as claim_ordinal,
         -- The events that have to be permuted to decide the key: everything but
         -- the source, which opens the balance rather than happening in it.
         count(*) filter (where e.ord_at > '-infinity') over w_key as movable
    from events e
  window
    w_key  as (partition by e.user_id, e.balance_key),
    w_prev as (partition by e.user_id, e.balance_key
               order by e.ord_at, e.ord_kind, e.ord_id
               rows between unbounded preceding and 1 preceding),
    w_upto as (partition by e.user_id, e.balance_key
               order by e.ord_at, e.ord_kind, e.ord_id
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
),

-- ── is there ANY order this key could have been written in? ─────────────────
-- What the replay reports comes from created_at. What it PROVES may not, because
-- created_at is `now()`, which is the transaction's START — and the invariant
-- serializes claims on a lock, so the write order is the lock order. A long
-- transaction can write after a later-starting one:
--
--   A begins 11:06:57 .............................. writes (32 units, 319 đồng)
--   B begins 11:06:59, writes (34, 339), commits
--
-- Both accepted — B against the full 1000 đồng / 100 units, A against the 661/66
-- B left it. Both rows pristine, both timestamps distinct, and in the WRONG order:
-- replayed by created_at the 34-unit row owes 341 and is two đồng out. Reproduced
-- with two sessions against the local stack. No comparison of created_at values
-- rescues that, whatever gap is allowed for, so the ordering is not assumed at all.
--
-- Instead the question #613 actually asks — "no ordering of any history could have
-- produced this row" — is answered directly, and it is cheaper than it looks. The
-- remaining balance after a SET of events does not depend on the order they came
-- in: it is the opening balance plus their deltas, and addition commutes. So this
-- is a search over subsets, not permutations. A subset is reachable when some
-- event in it is legal against the balance the rest of it leaves.
--
-- A key where SOME ordering is legal cannot be called proven, however damning the
-- created_at order looks; it drops to 'review' with the finding intact. Only a key
-- where the full set is unreachable by any route has no legal reading at all.
--
-- The cap is a resource bound, not a tolerance: a key with more than 14 movable
-- events is not searched and reports 'review'. Ordinary holdings are far below it,
-- and only keys that already produced a finding are searched at all — a clean
-- ledger does no work here.
movable as (
  select s.user_id, s.balance_key, s.is_debit, s.judge_here, s.quantity_valued,
         s.d_basis, s.d_units, s.took_principal, s.took_units,
         (row_number() over (partition by s.user_id, s.balance_key
                             order by s.ord_at, s.ord_kind, s.ord_id) - 1)::int as idx
    from state s
   where s.ord_at > '-infinity'
     and exists (select 1 from fails f
                  where f.user_id = s.user_id and f.balance_key = s.balance_key)
),
opening as (
  select s.user_id, s.balance_key,
         -- The source opens a parent-backed holding; a fund bucket opens at zero
         -- and is filled by the purchase events themselves.
         coalesce(sum(s.d_basis) filter (where s.ord_at = '-infinity'), 0) as open_basis,
         coalesce(sum(s.d_units) filter (where s.ord_at = '-infinity'), 0) as open_units,
         max(s.movable)::int as n
    from state s
   where exists (select 1 from fails f
                  where f.user_id = s.user_id and f.balance_key = s.balance_key)
   group by s.user_id, s.balance_key
),
reach as (
  select o.user_id, o.balance_key, 0::bigint as mask,
         o.open_basis as rem_basis, o.open_units as rem_units
    from opening o
   where o.n <= 14
  union
  select r.user_id, r.balance_key, r.mask | (1::bigint << m.idx),
         r.rem_basis + m.d_basis, r.rem_units + m.d_units
    from reach r
    join movable m
      on m.user_id = r.user_id and m.balance_key = r.balance_key
     and (r.mask >> m.idx) & 1 = 0
   where not m.is_debit
      -- A purchase claims nothing, and a claim the invariant does not measure here
      -- (a bucket's parent-backed claim) is only counted, never judged — so both
      -- may be placed anywhere.
      or not m.judge_here
      -- Otherwise it has to survive the same three questions, against the balance
      -- the rest of this subset leaves.
      or (not (m.took_units > 0
               and m.took_units > r.rem_units + case when r.rem_units > 0 then 0.0001 else 0 end)
          and not (m.quantity_valued and m.took_units > 0 and r.rem_units > 0
                   and abs(m.took_principal
                           - case when m.took_units < r.rem_units - 0.0001
                                    then round(m.took_units * r.rem_basis / r.rem_units)
                                  else r.rem_basis end) > 1)
          and not (not m.quantity_valued and m.took_principal > 0
                   and m.took_principal > r.rem_basis))
),
explainable as (
  select distinct r.user_id, r.balance_key
    from reach r
    join opening o on o.user_id = r.user_id and o.balance_key = r.balance_key
   where r.mask = (1::bigint << o.n) - 1
)

select distinct on (f.user_id, f.balance_key)
       f.failure::text  as check_name,
       -- Provable only where the replay's premise holds: nothing on this key was
       -- touched after it was written, so these rows ARE what was measured; the
       -- key was small enough to search; and no ordering of it is legal.
       case when f.key_touched
              or f.movable > 14
              or exists (select 1 from explainable x
                          where x.user_id = f.user_id and x.balance_key = f.balance_key)
              then 'review' else 'violation' end::text as severity,
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
