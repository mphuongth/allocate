-- Expand the shared `banks` reference list to cover (nearly) every bank a
-- Vietnamese user is likely to hold a deposit at. The original seed
-- (20260620000001) only carried the top 20, so the deposit form's bank picker
-- couldn't offer the rest — a user at, say, SCB or Shinhan simply had no row to
-- select. This adds the remaining domestic joint-stock banks, the state-resolved
-- / restructured banks, and the common 100%-foreign-owned banks.
--
-- Reference data, same for every user, managed only via migration (see the
-- original table + RLS in 20260620000001). `on conflict do nothing` keeps this
-- idempotent and leaves the existing 20 rows (and their sort_order) untouched.
--
-- sort_order convention (unchanged): 10 = state-owned "big four", 20 = major
-- joint-stock, 30 = other domestic, 40 = foreign-owned.

insert into public.banks (code, name, sort_order) values
  -- Other domestic joint-stock / restructured banks
  ('SCB',      'SCB',                    30),
  ('PVCB',     'PVcomBank',              30),
  ('BAB',      'Bac A Bank',             30),
  ('ABB',      'ABBank',                 30),
  ('NCB',      'NCB',                    30),
  ('KLB',      'KienlongBank',           30),
  ('VBB',      'VietBank',               30),
  ('SGB',      'Saigonbank',             30),
  ('BVBANK',   'BVBank',                 30),
  ('BAOVIET',  'BaoViet Bank',           30),
  ('PGB',      'PGBank',                 30),
  ('GPB',      'GPBank',                 30),
  ('CBB',      'CBBank',                 30),
  ('OCEANBANK','OceanBank',              30),
  ('VIKKI',    'Vikki Bank',             30),
  ('COOP',     'Co-opBank',              30),
  -- 100%-foreign-owned / joint-venture banks operating in Vietnam
  ('SHBVN',    'Shinhan Bank',           40),
  ('UOB',      'UOB Vietnam',            40),
  ('HSBC',     'HSBC Vietnam',           40),
  ('SCVN',     'Standard Chartered',     40),
  ('WOORI',    'Woori Bank',             40),
  ('PBVN',     'Public Bank Vietnam',    40),
  ('HLBVN',    'Hong Leong Bank',        40),
  ('CIMB',     'CIMB Vietnam',           40),
  ('IVB',      'Indovina Bank',          40)
on conflict (code) do nothing;
