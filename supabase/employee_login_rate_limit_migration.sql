-- S.R. Developers CRM: durable login attempt throttle
-- Apply in Supabase SQL Editor before deploying the updated login Edge Function.
-- Rate limit: 10 attempts per hashed normalized identifier in a 15-minute window (identifier-only; not IP-based).
create table if not exists public.employee_login_rate_limits (
  key_hash text primary key check (key_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null default now(),
  attempts integer not null default 1 check (attempts >= 1),
  updated_at timestamptz not null default now()
);
alter table public.employee_login_rate_limits enable row level security;
revoke all on public.employee_login_rate_limits from anon, authenticated;
grant all on public.employee_login_rate_limits to service_role;

create or replace function public.consume_employee_login_attempt(p_key_hash text)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  v_attempts integer;
  v_window timestamptz;
begin
  if p_key_hash is null or p_key_hash !~ '^[a-f0-9]{64}$' then
    return false;
  end;
  insert into public.employee_login_rate_limits(key_hash, window_started_at, attempts, updated_at)
  values (p_key_hash, now(), 1, now())
  on conflict (key_hash) do update
    set window_started_at = case
          when public.employee_login_rate_limits.window_started_at <= now() - interval '15 minutes' then now()
          else public.employee_login_rate_limits.window_started_at end,
        attempts = case
          when public.employee_login_rate_limits.window_started_at <= now() - interval '15 minutes' then 1
          else public.employee_login_rate_limits.attempts + 1 end,
        updated_at = now()
  returning attempts, window_started_at into v_attempts, v_window;
  return v_attempts <= 10 and v_window > now() - interval '15 minutes';
end;
$$;
revoke all on function public.consume_employee_login_attempt(text) from public, anon, authenticated;
grant execute on function public.consume_employee_login_attempt(text) to service_role;

-- Optional housekeeping: run periodically (e.g. daily) to remove expired keys.
delete from public.employee_login_rate_limits
where updated_at < now() - interval '2 days';
