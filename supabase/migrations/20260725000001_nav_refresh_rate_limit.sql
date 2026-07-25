-- Per-user rate limit for the NAV refresh fan-out (#515).
--
-- POST /api/v1/funds/refresh-nav lets any authenticated user trigger an outbound
-- scrape for every fund they own (and the Dragon Capital scraper alone makes ~15
-- upstream calls per fund). Nothing stopped a caller from hammering it, driving
-- serverless cost and load on the provider sites.
--
-- This is a durable, atomic fixed-window limiter: one row per user tracks the
-- current window start and request count. The whole check-and-increment happens
-- in a single INSERT ... ON CONFLICT DO UPDATE so two concurrent calls can't both
-- read a stale count (the row lock on conflict serializes them).

create table if not exists public.nav_refresh_rate_limit (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  window_start  timestamptz not null default now(),
  request_count int not null default 0,
  updated_at    timestamptz not null default now()
);

-- Only the SECURITY DEFINER function below may touch this table. RLS on + no
-- policies + revoked grants means a user cannot read or reset their own counter
-- directly (which would defeat the limit) — they can only go through the RPC.
alter table public.nav_refresh_rate_limit enable row level security;
revoke all on public.nav_refresh_rate_limit from anon, authenticated;

-- Atomically record one refresh attempt for the current caller and report whether
-- it is allowed. Runs as owner (security definer) so it can maintain the locked-
-- down table, but scopes everything to auth.uid() — a caller can only ever affect
-- their own row. A blocked attempt still increments the count (so hammering keeps
-- you blocked) but never advances window_start, so the lockout is bounded by the
-- window length.
create or replace function public.check_nav_refresh_rate_limit(
  p_max int,
  p_window_seconds int
)
returns table (allowed boolean, retry_after_seconds int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := auth.uid();
  v_window interval := make_interval(secs => p_window_seconds);
  v_now    timestamptz := now();
  v_start  timestamptz;
  v_count  int;
begin
  if v_user is null then
    allowed := false;
    retry_after_seconds := p_window_seconds;
    return next;
    return;
  end if;

  insert into public.nav_refresh_rate_limit as r (user_id, window_start, request_count, updated_at)
  values (v_user, v_now, 1, v_now)
  on conflict (user_id) do update
    set window_start  = case when v_now - r.window_start >= v_window then v_now else r.window_start end,
        request_count = case when v_now - r.window_start >= v_window then 1    else r.request_count + 1 end,
        updated_at    = v_now
  returning r.window_start, r.request_count into v_start, v_count;

  if v_count <= p_max then
    allowed := true;
    retry_after_seconds := 0;
  else
    allowed := false;
    retry_after_seconds := greatest(1, ceil(extract(epoch from (v_start + v_window - v_now)))::int);
  end if;
  return next;
end;
$$;

grant execute on function public.check_nav_refresh_rate_limit(int, int) to authenticated;
