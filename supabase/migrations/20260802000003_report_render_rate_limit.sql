-- Per-user render budget for the PDF portfolio report (#594).
--
-- POST /api/v1/report renders a PDF server-side. It is the most expensive thing
-- an authenticated user can ask this app to do, and nothing bounded how often
-- they could ask — the endpoint had no limit at all, and (before this change)
-- also rendered a payload the caller supplied, so the cost per request was the
-- caller's to choose. The payload now comes from the user's own holdings; this
-- caps the rate.
--
-- Same shape as the gold-refresh (20260727000004) and NAV (20260725000001)
-- limiters, deliberately: one pattern to understand, separate counters and
-- policies so retuning one never drags the others with it.
--
-- Durable, atomic fixed window: one row per user tracks the window start and a
-- request count, and the whole check-and-increment happens in a single
-- INSERT … ON CONFLICT DO UPDATE, so two concurrent calls can't both read a
-- stale count (the row lock on conflict serializes them).

create table if not exists public.report_render_rate_limit (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  window_start  timestamptz not null default now(),
  request_count int not null default 0,
  updated_at    timestamptz not null default now()
);

-- Only the SECURITY DEFINER function below may touch this table. RLS on, no
-- policies, and revoked grants means a user cannot read or reset their own
-- counter directly (which would defeat the limit) — they can only go through
-- the RPC.
alter table public.report_render_rate_limit enable row level security;
revoke all on public.report_render_rate_limit from anon, authenticated;

-- Atomically record one report render for the current caller and report whether
-- it is allowed. Runs as owner so it can maintain the locked-down table, but
-- scopes everything to auth.uid() — a caller can only ever affect their own row.
-- A blocked attempt still increments the count (so hammering keeps you blocked)
-- but never advances window_start, so the lockout stays bounded by the window.
--
-- The policy is HARDCODED, not passed in: the function is granted to
-- `authenticated` so a client's supabase-js can reach it, which means an
-- attacker could otherwise invoke it directly with a degenerate window (e.g. 0
-- seconds) and reset their own counter before every export.
--
-- 10 per minute: exporting is a deliberate, occasional action (a human clicks a
-- button and waits for a download), so this is far above real use and still caps
-- a scripted loop at one render every 6 seconds. It also leaves the report E2E
-- spec — four exports for the same account in one run — clear of the limit.
create or replace function public.check_report_render_rate_limit()
returns table (allowed boolean, retry_after_seconds int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max    constant int := 10;
  v_window constant interval := interval '60 seconds';
  v_user   uuid := auth.uid();
  v_now    timestamptz := now();
  v_start  timestamptz;
  v_count  int;
begin
  if v_user is null then
    allowed := false;
    retry_after_seconds := 60;
    return next;
    return;
  end if;

  insert into public.report_render_rate_limit as r (user_id, window_start, request_count, updated_at)
  values (v_user, v_now, 1, v_now)
  on conflict (user_id) do update
    set window_start  = case when v_now - r.window_start >= v_window then v_now else r.window_start end,
        request_count = case when v_now - r.window_start >= v_window then 1    else r.request_count + 1 end,
        updated_at    = v_now
  returning r.window_start, r.request_count into v_start, v_count;

  if v_count <= v_max then
    allowed := true;
    retry_after_seconds := 0;
  else
    allowed := false;
    retry_after_seconds := greatest(1, ceil(extract(epoch from (v_start + v_window - v_now)))::int);
  end if;
  return next;
end;
$$;

-- EXECUTE is granted to PUBLIC by default, so revoke it (covering anon and
-- authenticated) and re-grant only to authenticated. anon is revoked explicitly
-- too, in case any prior grant targeted it directly.
revoke all on function public.check_report_render_rate_limit() from public;
revoke all on function public.check_report_render_rate_limit() from anon;
grant execute on function public.check_report_render_rate_limit() to authenticated;

comment on function public.check_report_render_rate_limit() is
  'Atomically records one PDF report render for auth.uid() and reports whether it is within the fixed window (10 per 60s). Backs POST /api/v1/report (#594).';
