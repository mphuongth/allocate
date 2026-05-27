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
