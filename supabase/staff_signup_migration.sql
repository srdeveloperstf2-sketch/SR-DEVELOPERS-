-- Staff self-registration requests + admin approval workflow.
-- Run after ONE_TIME_SETUP.sql and app_cloud_sync_migration.sql.
create table if not exists public.staff_signup_requests (
 id uuid primary key default gen_random_uuid(),
 full_name text not null check(length(trim(full_name)) between 2 and 100),
 email text not null,
 phone text,
 requested_role text not null default 'sales_executive' check(requested_role in ('sales_executive','team_leader','manager')),
 message text,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 reviewed_by uuid references public.profiles(id),
 reviewed_at timestamptz,
 created_at timestamptz not null default now()
);
create unique index if not exists staff_signup_pending_email_idx on public.staff_signup_requests(lower(email)) where status='pending';
alter table public.staff_signup_requests enable row level security;
drop policy if exists staff_signup_public_insert on public.staff_signup_requests;
create policy staff_signup_public_insert on public.staff_signup_requests for insert to anon, authenticated
with check (status='pending' and requested_role in ('sales_executive','team_leader','manager') and reviewed_by is null and reviewed_at is null);
drop policy if exists staff_signup_admin_read on public.staff_signup_requests;
create policy staff_signup_admin_read on public.staff_signup_requests for select to authenticated using(public.is_admin());
drop policy if exists staff_signup_admin_update on public.staff_signup_requests;
create policy staff_signup_admin_update on public.staff_signup_requests for update to authenticated using(public.is_admin()) with check(public.is_admin());
grant insert on public.staff_signup_requests to anon, authenticated;
grant select,update on public.staff_signup_requests to authenticated;
