-- S.R. Developers CRM — Staff Control Center upgrade
-- Run this migration in Supabase SQL Editor AFTER ONE_TIME_SETUP.sql,
-- app_cloud_sync_migration.sql and final_hardening_migration.sql.
begin;

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  leave_type text not null default 'casual' check (leave_type in ('casual','sick','earned','unpaid','other')),
  start_date date not null,
  end_date date not null,
  reason text not null check (length(trim(reason)) between 3 and 1000),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  reviewer_note text,
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  check ((status='pending' and reviewed_by is null and reviewed_at is null) or status<>'pending')
);
create index if not exists leave_requests_employee_dates_idx
  on public.leave_requests(employee_id,start_date,end_date);
create index if not exists leave_requests_status_created_idx
  on public.leave_requests(status,created_at desc);
alter table public.leave_requests enable row level security;

drop policy if exists leave_requests_read_scope on public.leave_requests;
create policy leave_requests_read_scope on public.leave_requests
for select to authenticated
using (employee_id=auth.uid() or public.is_admin() or public.is_in_my_team(employee_id));

drop policy if exists leave_requests_insert_self on public.leave_requests;
create policy leave_requests_insert_self on public.leave_requests
for insert to authenticated
with check (
  employee_id=auth.uid() and status='pending'
  and reviewed_by is null and reviewed_at is null
);

drop policy if exists leave_requests_review_scope on public.leave_requests;
create policy leave_requests_review_scope on public.leave_requests
for update to authenticated
using (
  public.is_admin() or
  (public.current_role() in ('manager','team_leader') and public.is_in_my_team(employee_id))
)
with check (
  (public.is_admin() or
   (public.current_role() in ('manager','team_leader') and public.is_in_my_team(employee_id)))
  and status in ('approved','rejected','cancelled')
  and reviewed_by=auth.uid()
  and reviewed_at is not null
);

grant select,insert,update on public.leave_requests to authenticated;

-- Attendance is per employee and date; only the employee or Admin can write.
create index if not exists attendance_date_idx on public.attendance(attendance_date desc);
create index if not exists attendance_user_date_idx on public.attendance(user_id,attendance_date desc);

commit;
