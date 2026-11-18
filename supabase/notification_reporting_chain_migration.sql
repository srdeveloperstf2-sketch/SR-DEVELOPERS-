-- S.R. Developers CRM: route activity notifications to the relevant reporting chain.
-- Run AFTER admin_notifications_migration.sql and activity_notifications_migration.sql.
-- No existing profiles, CRM records, IDs or passwords are changed.
begin;

drop policy if exists admin_notifications_read_own on public.admin_notifications;
create policy admin_notifications_read_own on public.admin_notifications
  for select to authenticated
  using (recipient_id = auth.uid());

drop policy if exists admin_notifications_update_own on public.admin_notifications;
create policy admin_notifications_update_own on public.admin_notifications
  for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

create or replace function public.sr_notify_admins(
  p_event_type text,
  p_title text,
  p_actor_id uuid default null,
  p_actor_name text default null,
  p_actor_role text default null,
  p_employee_name text default null,
  p_employee_phone text default null,
  p_employee_role text default null,
  p_owner_id uuid default null,
  p_owner_name text default null,
  p_manager_name text default null,
  p_team_leader_name text default null,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_project_name text default null,
  p_record_id uuid default null
) returns void
language plpgsql security definer set search_path=public as $$
declare
  v_manager_id uuid;
  v_team_leader_id uuid;
begin
  if p_owner_id is not null then
    select manager_id,team_leader_id into v_manager_id,v_team_leader_id
    from public.profiles where id=p_owner_id;
  end if;

  insert into public.admin_notifications(
    recipient_id,event_type,title,actor_id,actor_name,actor_role,
    employee_name,employee_phone,employee_role,owner_id,owner_name,
    manager_name,team_leader_name,customer_name,customer_phone,project_name,record_id
  )
  select distinct target.id,p_event_type,p_title,p_actor_id,p_actor_name,p_actor_role,
    p_employee_name,p_employee_phone,p_employee_role,p_owner_id,p_owner_name,
    p_manager_name,p_team_leader_name,p_customer_name,p_customer_phone,p_project_name,p_record_id
  from public.profiles target
  where target.is_active=true
    and (
      target.role='admin'
      or target.id=p_actor_id
      or target.id=p_owner_id
      or target.id=v_manager_id
      or target.id=v_team_leader_id
    );
end;
$$;

commit;
