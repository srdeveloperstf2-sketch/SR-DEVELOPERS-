-- S.R. Developers CRM — Channel Partner self-registration and approval
-- Run after ONE_TIME_SETUP.sql (which creates channel_partners and partner_leads).
begin;

create table if not exists public.partner_signup_requests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 2 and 100),
  email text not null,
  phone text,
  partner_type text not null default 'Individual Broker',
  firm_name text,
  area text,
  project_interest text,
  message text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists partner_signup_status_created_idx
  on public.partner_signup_requests(status, created_at desc);
create unique index if not exists partner_signup_pending_email_idx
  on public.partner_signup_requests(lower(email)) where status='pending';

alter table public.partner_signup_requests enable row level security;
drop policy if exists partner_signup_public_insert on public.partner_signup_requests;
create policy partner_signup_public_insert on public.partner_signup_requests
  for insert to anon, authenticated
  with check (status='pending' and reviewed_by is null and reviewed_at is null);
drop policy if exists partner_signup_admin_read on public.partner_signup_requests;
create policy partner_signup_admin_read on public.partner_signup_requests
  for select to authenticated using (public.is_admin());
drop policy if exists partner_signup_admin_update on public.partner_signup_requests;
create policy partner_signup_admin_update on public.partner_signup_requests
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

grant insert on public.partner_signup_requests to anon, authenticated;
grant select, update on public.partner_signup_requests to authenticated;

commit;
