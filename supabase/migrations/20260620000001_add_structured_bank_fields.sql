-- Structured bank reference + gate fields — foundation (PR0) for the "Gộp nhiều
-- nguồn" (multi-source merge) feature.
--
-- Until now a deposit's bank lived only in free-text notes/name, which can't be
-- grouped or filtered reliably (parsing "MB Term 6M" breaks the moment a user
-- renames the deposit). This migration makes the bank a real reference and adds
-- two cheap "honest gate" fields the merge-eligibility rules need:
--   • a small shared `banks` reference table (code -> name + logo),
--   • investment_transactions.bank_code -> a real FK so provenance and the
--     re-deposit destination point at a bank, not a parsed string,
--   • currency (default 'VND') so the "same currency" rule is a real predicate
--     without building the full multi-currency epic yet,
--   • is_pledged (default false) so the "not pledged" rule is honest (a no-op
--     until pledged/collateral deposits are actually modelled).
-- All columns are nullable / defaulted, so existing deposits are untouched
-- (bank_code stays NULL and every consumer must tolerate that).

create table if not exists public.banks (
  code text primary key,
  name text not null,
  logo_url text,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

-- Reference data shared across all users: readable by any authenticated user,
-- changed only via migration (no user-facing writes).
alter table public.banks enable row level security;
drop policy if exists "banks_select" on public.banks;
create policy "banks_select" on public.banks
  for select to authenticated using (true);

insert into public.banks (code, name, sort_order) values
  ('VCB',  'Vietcombank', 10),
  ('BIDV', 'BIDV',        10),
  ('CTG',  'VietinBank',  10),
  ('AGR',  'Agribank',    10),
  ('TCB',  'Techcombank', 20),
  ('MB',   'MB Bank',     20),
  ('ACB',  'ACB',         20),
  ('VPB',  'VPBank',      20),
  ('TPB',  'TPBank',      20),
  ('STB',  'Sacombank',   20),
  ('HDB',  'HDBank',      20),
  ('VIB',  'VIB',         20),
  ('SHB',  'SHB',         20),
  ('OCB',  'OCB',         20),
  ('MSB',  'MSB',         20),
  ('SSB',  'SeABank',     20),
  ('EIB',  'Eximbank',    20),
  ('LPB',  'LPBank',      20),
  ('NAB',  'Nam A Bank',  30),
  ('VAB',  'VietABank',   30)
on conflict (code) do nothing;

alter table public.investment_transactions
  add column if not exists bank_code text references public.banks(code),
  add column if not exists currency text not null default 'VND',
  add column if not exists is_pledged boolean not null default false;

create index if not exists investment_transactions_bank_code_idx
  on public.investment_transactions (bank_code);
