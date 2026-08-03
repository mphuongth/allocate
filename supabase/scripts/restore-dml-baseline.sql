-- Restore the hosted-project DML baseline on a local Supabase stack (#595).
--
-- A hosted Supabase project grants anon/authenticated/service_role full DML on
-- everything in `public` through its default privileges, which is why none of
-- this app's migrations carry a GRANT. Recent Supabase CLI versions grant the
-- local stack only the non-DML part of that default (`Dxtm` —
-- truncate/references/trigger/maintain), so seeding an E2E fixture fails with
-- `42501 permission denied for table …`.
--
-- Top up DML *only for roles still present in an object's ACL*. That is the
-- distinction that matters: a migration's `revoke all on <table> from anon,
-- authenticated` removes the role from the ACL entirely, so those deliberate
-- revocations survive this script instead of being handed back (e.g.
-- withdrawal_ledger_audit, report_render_rate_limit). Functions are left alone
-- for the same reason — migrations manage their EXECUTE grants explicitly
-- (refresh_gold_price_all is service_role only), and functions with no explicit
-- ACL already get PUBLIC EXECUTE exactly as they do in production.
--
-- Caveat: this restores the full DML set, so a *partial* revoke (revoking only
-- INSERT, say) would be undone. The schema has none today — every revocation is
-- `revoke all`.
--
-- Safe to re-run, and a no-op on a stack that already has the full grants.
-- Run it with `npm run db:baseline` after `supabase start`.

DO $$
DECLARE obj record;
BEGIN
  FOR obj IN
    SELECT DISTINCT c.oid::regclass::text AS rel,
                    pg_get_userbyid(a.grantee) AS grantee
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE c.relkind IN ('r', 'p', 'v', 'm')
      AND pg_get_userbyid(a.grantee) IN ('anon', 'authenticated', 'service_role')
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO %I', obj.rel, obj.grantee);
  END LOOP;
END
$$;
