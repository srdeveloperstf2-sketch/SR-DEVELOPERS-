-- CANONICAL partner signup requests migration for new installations.
-- For existing production databases, run the preflight in PRODUCTION_SECURITY_FINALIZATION_RUNBOOK.md
-- and reconcile table constraints/policies before applying. Do not blindly rerun either legacy file.
begin;
create table if not exists public.partner_signup_requests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(trim(full_name)) between 2 and 100),
  email text not null check (email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'),
  phone text not null check (char_length(trim(phone)) >= 8),
  partner_type text not null check (partner_type in ('Individual Broker','Channel Partner Agency','Firm Associate')),
  firm_name text,
  area text,
  project_interest text,
  message text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists partner_signup_requests_status_created_idx
  on public.partner_signup_requests(status, created_at desc);
create unique index if not exists partner_signup_pending_email_idx
  on public.partner_signup_requests(lower(email)) where status='pending';
alter table public.partner_signup_requests enable row level security;
drop policy if exists partner_signup_public_submit on public.partner_signup_requests;
drop policy if exists partner_signup_public_insert on public.partner_signup_requests;
drop policy if exists partner_signup_public_submit_strict on public.partner_signup_requests;
create policy partner_signup_public_submit_strict on public.partner_signup_requests
  for insert to anon, authenticated
  with check (status='pending' and reviewed_by is null and reviewed_at is null
    and char_length(trim(full_name)) between 2 and 100
    and email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
    and char_length(trim(phone)) >= 8
    and partner_type in ('Individual Broker','Channel Partner Agency','Firm Associate'));
drop policy if exists partner_signup_admin_read on public.partner_signup_requests;
create policy partner_signup_admin_read on public.partner_signup_requests
  for select to authenticated using (public.is_admin());
drop policy if exists partner_signup_admin_update on public.partner_signup_requests;
create policy partner_signup_admin_update on public.partner_signup_requests
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.partner_signup_requests from anon, authenticated;
grant insert on public.partner_signup_requests to anon, authenticated;
grant select, update on public.partner_signup_requests to authenticated;
commit;
