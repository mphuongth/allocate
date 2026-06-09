-- The health_check liveness-probe table exists on the live database but was
-- created out-of-band (no committed migration created it), so a from-scratch
-- replay (`supabase db reset` / fresh env / CI test project) failed when the
-- ALTER below runs. Create it here (idempotently) to make the migrations
-- faithfully reproduce production. Matches prod: 3 columns, no constraints,
-- and one heartbeat row.
CREATE TABLE IF NOT EXISTS public.health_check (
  id UUID DEFAULT gen_random_uuid(),
  status TEXT DEFAULT 'ok',
  created_at TIMESTAMP DEFAULT now()
);

INSERT INTO public.health_check (status)
SELECT 'ok'
WHERE NOT EXISTS (SELECT 1 FROM public.health_check);

-- Enable Row Level Security on health_check.
-- Before this change the table was exposed to the anon role (which has the
-- public NEXT_PUBLIC_SUPABASE_ANON_KEY), allowing anyone to INSERT/UPDATE/DELETE
-- rows. The table is for liveness probes only, so we keep SELECT open to all
-- roles via an explicit policy but block writes entirely.

ALTER TABLE public.health_check ENABLE ROW LEVEL SECURITY;

-- Anyone (anon + authenticated) can read the heartbeat row; no other
-- policies are added, so INSERT/UPDATE/DELETE are denied for everyone except
-- the service role.
CREATE POLICY "health_check_public_read"
  ON public.health_check
  FOR SELECT
  TO anon, authenticated
  USING (true);
