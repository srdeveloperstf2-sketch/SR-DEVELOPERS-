-- S.R. Developers CRM: close direct-self RLS bypasses for inactive staff.
-- Apply after rls_inactive_staff_access_guard.sql and the referenced table migrations.
-- This is additive policy hardening; no row data is changed.

begin;

-- Cloud-synced app rows previously had direct created_by/owner self-access.
-- Require an active staff profile for every operation.
drop policy if exists crm_records_read_scope on public.crm_records;
create policy crm_records_read_scope on public.crm_records for select to authenticated
using (public.current_role() is not null and (
  public.is_admin() or created_by=auth.uid() or owner_id=auth.uid() or public.is_in_my_team(owner_id)
));

drop policy if exists crm_records_insert_scope on public.crm_records;
create policy crm_records_insert_scope on public.crm_records for insert to authenticated
with check (public.current_role() is not null and created_by=auth.uid() and (
  owner_id=auth.uid() or public.is_admin() or public.is_in_my_team(owner_id)
));

drop policy if exists crm_records_update_scope on public.crm_records;
create policy crm_records_update_scope on public.crm_records for update to authenticated
using (public.current_role() is not null and (
  public.is_admin() or created_by=auth.uid() or owner_id=auth.uid() or public.is_in_my_team(owner_id)
))
with check (public.current_role() is not null and (
  public.is_admin() or created_by=auth.uid() or owner_id=auth.uid() or public.is_in_my_team(owner_id)
));

drop policy if exists crm_records_delete_scope on public.crm_records;
create policy crm_records_delete_scope on public.crm_records for delete to authenticated
using (public.current_role() is not null and (public.is_admin() or created_by=auth.uid()));

-- Attendance self-access is also gated by active staff status.
drop policy if exists attendance_read_scope on public.attendance;
create policy attendance_read_scope on public.attendance for select to authenticated
using (public.current_role() is not null and (
  public.is_admin() or user_id=auth.uid() or public.can_access_profile(user_id)
));

drop policy if exists attendance_insert_self on public.attendance;
create policy attendance_insert_self on public.attendance for insert to authenticated
with check (public.current_role() is not null and user_id=auth.uid());

drop policy if exists attendance_update_scope on public.attendance;
create policy attendance_update_scope on public.attendance for update to authenticated
using (public.current_role() is not null and (public.is_admin() or user_id=auth.uid()))
with check (public.current_role() is not null and (public.is_admin() or user_id=auth.uid()));

-- Targets and team messages: deny inactive-profile self shortcuts.
drop policy if exists targets_scope on public.targets;
create policy targets_scope on public.targets for all to authenticated
using (public.current_role() is not null and (
  public.is_admin() or user_id=auth.uid() or public.can_access_profile(user_id)
))
with check (public.current_role() is not null and created_by=auth.uid()
  and public.current_role() in ('admin','manager','team_leader'));

drop policy if exists messages_read on public.team_messages;
create policy messages_read on public.team_messages for select to authenticated
using (public.current_role() is not null and (
  public.is_admin() or sender_id=auth.uid()
  or exists(select 1 from public.profiles p where p.id=sender_id and p.manager_id=auth.uid() and public.is_manager())
));

drop policy if exists messages_insert on public.team_messages;
create policy messages_insert on public.team_messages for insert to authenticated
with check (public.current_role() is not null and sender_id=auth.uid());

-- Leave requests: every policy requires an active staff role.
drop policy if exists leave_requests_read_scope on public.leave_requests;
create policy leave_requests_read_scope on public.leave_requests for select to authenticated
using (public.current_role() is not null and (
  employee_id=auth.uid() or public.is_admin() or public.is_in_my_team(employee_id)
));

drop policy if exists leave_requests_insert_self on public.leave_requests;
create policy leave_requests_insert_self on public.leave_requests for insert to authenticated
with check (public.current_role() is not null and employee_id=auth.uid()
  and status='pending' and reviewed_by is null and reviewed_at is null
);

drop policy if exists leave_requests_review_scope on public.leave_requests;
create policy leave_requests_review_scope on public.leave_requests for update to authenticated
using (public.current_role() is not null and (
  public.is_admin() or (public.current_role() in ('manager','team_leader') and public.is_in_my_team(employee_id))
))
with check (public.current_role() is not null and (
  public.is_admin() or (public.current_role() in ('manager','team_leader') and public.is_in_my_team(employee_id))
) and status in ('approved','rejected','cancelled') and reviewed_by=auth.uid() and reviewed_at is not null);

commit;
