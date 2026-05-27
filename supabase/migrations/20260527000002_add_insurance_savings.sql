-- Backfill: insurance_savings table already exists in the production database
-- (created out-of-band) and is correctly secured with RLS, but it was never
-- captured in a migration. This file documents the schema so future fresh
-- environments stay in sync. CREATE TABLE IF NOT EXISTS + IF NOT EXISTS on
-- the policies makes it a safe no-op against the live database.

CREATE TABLE IF NOT EXISTS public.insurance_savings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  insurance_member_id uuid NOT NULL REFERENCES public.insurance_members(member_id) ON DELETE CASCADE,
  amount_saved_vnd    numeric NOT NULL CHECK (amount_saved_vnd > 0::numeric),
  saved_date          date NOT NULL DEFAULT CURRENT_DATE,
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE public.insurance_savings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'insurance_savings' AND policyname = 'insurance_savings_select') THEN
    CREATE POLICY "insurance_savings_select" ON public.insurance_savings
      FOR SELECT TO authenticated USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'insurance_savings' AND policyname = 'insurance_savings_insert') THEN
    CREATE POLICY "insurance_savings_insert" ON public.insurance_savings
      FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'insurance_savings' AND policyname = 'insurance_savings_update') THEN
    CREATE POLICY "insurance_savings_update" ON public.insurance_savings
      FOR UPDATE TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'insurance_savings' AND policyname = 'insurance_savings_delete') THEN
    CREATE POLICY "insurance_savings_delete" ON public.insurance_savings
      FOR DELETE TO authenticated USING (user_id = auth.uid());
  END IF;
END $$;
