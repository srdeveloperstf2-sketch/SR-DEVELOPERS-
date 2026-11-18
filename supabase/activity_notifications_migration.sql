-- S.R. Developers CRM: extended Admin activity alerts
-- Run AFTER admin_notifications_migration.sql and staff_control_center_migration.sql.
begin;

alter table public.admin_notifications
  drop constraint if exists admin_notifications_event_type_check;
alter table public.admin_notifications
  add constraint admin_notifications_event_type_check
  check (event_type in (
    'staff_signup','staff_joined','lead_created',
    'attendance_checkin','attendance_checkout',
    'leave_requested','leave_approved','leave_rejected',
    'followup_created','visit_created','booking_created','call_logged'
  ));

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
begin
  insert into public.admin_notifications(
    recipient_id,event_type,title,actor_id,actor_name,actor_role,
    employee_name,employee_phone,employee_role,owner_id,owner_name,
    manager_name,team_leader_name,customer_name,customer_phone,project_name,record_id
  )
  select p.id,p_event_type,p_title,p_actor_id,p_actor_name,p_actor_role,
    p_employee_name,p_employee_phone,p_employee_role,p_owner_id,p_owner_name,
    p_manager_name,p_team_leader_name,p_customer_name,p_customer_phone,p_project_name,p_record_id
  from public.profiles p where p.role='admin' and p.is_active=true;
end;
$$;

create or replace function public.sr_notify_attendance_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_staff public.profiles%rowtype;
  v_kind text;
begin
  select * into v_staff from public.profiles where id=new.user_id;
  if tg_op='INSERT' and new.check_in is not null then
    v_kind := 'attendance_checkin';
    perform public.sr_notify_admins(v_kind,'कर्मचारी ने Check In किया',
      new.user_id,v_staff.full_name,v_staff.role,v_staff.full_name,v_staff.phone,v_staff.role,
      new.user_id,v_staff.full_name,null,null,null,null,null,new.id);
  elsif tg_op='UPDATE' and old.check_out is null and new.check_out is not null then
    v_kind := 'attendance_checkout';
    perform public.sr_notify_admins(v_kind,'कर्मचारी ने Check Out किया',
      new.user_id,v_staff.full_name,v_staff.role,v_staff.full_name,v_staff.phone,v_staff.role,
      new.user_id,v_staff.full_name,null,null,null,null,null,new.id);
  elsif tg_op='UPDATE' and old.check_in is null and new.check_in is not null then
    v_kind := 'attendance_checkin';
    perform public.sr_notify_admins(v_kind,'कर्मचारी ने Check In किया',
      new.user_id,v_staff.full_name,v_staff.role,v_staff.full_name,v_staff.phone,v_staff.role,
      new.user_id,v_staff.full_name,null,null,null,null,null,new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists sr_notify_attendance_change_trg on public.attendance;
create trigger sr_notify_attendance_change_trg
after insert or update of check_in,check_out on public.attendance
for each row execute function public.sr_notify_attendance_change();

create or replace function public.sr_notify_leave_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_staff public.profiles%rowtype;
  v_manager text;
  v_team_leader text;
  v_kind text;
begin
  select * into v_staff from public.profiles where id=new.employee_id;
  select full_name into v_manager from public.profiles where id=v_staff.manager_id;
  select full_name into v_team_leader from public.profiles where id=v_staff.team_leader_id;
  if tg_op='INSERT' then
    v_kind := 'leave_requested';
    perform public.sr_notify_admins(v_kind,'नई Leave Request आई है',
      new.employee_id,v_staff.full_name,v_staff.role,v_staff.full_name,v_staff.phone,v_staff.role,
      new.employee_id,v_staff.full_name,v_manager,v_team_leader,
      new.leave_type||' · '||new.start_date::text||' से '||new.end_date::text,new.reason,null,new.id);
  elsif tg_op='UPDATE' and old.status is distinct from new.status and new.status in ('approved','rejected') then
    v_kind := case when new.status='approved' then 'leave_approved' else 'leave_rejected' end;
    perform public.sr_notify_admins(v_kind,'Leave Request पर निर्णय: '||upper(new.status),
      new.reviewed_by,null,null,v_staff.full_name,v_staff.phone,v_staff.role,
      new.employee_id,v_staff.full_name,v_manager,v_team_leader,
      new.leave_type||' · '||new.start_date::text||' से '||new.end_date::text,new.reviewer_note,null,new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists sr_notify_leave_change_trg on public.leave_requests;
create trigger sr_notify_leave_change_trg
after insert or update of status on public.leave_requests
for each row execute function public.sr_notify_leave_change();

create or replace function public.sr_notify_new_crm_activity()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_actor public.profiles%rowtype;
  v_owner public.profiles%rowtype;
  v_manager text;
  v_team_leader text;
  v_payload jsonb;
  v_related jsonb := '{}'::jsonb;
  v_related_id uuid;
  v_kind text;
  v_title text;
begin
  if new.record_type not in ('lead','followup','visit','booking','call_log') then
    return new;
  end if;
  v_payload := coalesce(new.payload,'{}'::jsonb);
  begin
    v_related_id := nullif(v_payload->>'lead','')::uuid;
  exception when invalid_text_representation then
    v_related_id := null;
  end;
  if v_related_id is not null then
    select coalesce(payload,'{}'::jsonb) into v_related
    from public.crm_records where id=v_related_id and record_type='lead';
  end if;
  select * into v_actor from public.profiles where id=new.created_by;
  select * into v_owner from public.profiles where id=new.owner_id;
  select full_name into v_manager from public.profiles where id=v_owner.manager_id;
  select full_name into v_team_leader from public.profiles where id=v_owner.team_leader_id;
  if new.record_type='lead' then v_kind:='lead_created';v_title:='नई Lead CRM में जोड़ी गई';
  elsif new.record_type='followup' then v_kind:='followup_created';v_title:='नया Follow-up दर्ज हुआ';
  elsif new.record_type='visit' then v_kind:='visit_created';v_title:='नई Site Visit दर्ज हुई';
  elsif new.record_type='booking' then v_kind:='booking_created';v_title:='नई Booking दर्ज हुई';
  else v_kind:='call_logged';v_title:='Lead पर Call Activity दर्ज हुई';
  end if;
  perform public.sr_notify_admins(
    v_kind,v_title,new.created_by,v_actor.full_name,v_actor.role,
    null,null,null,new.owner_id,v_owner.full_name,v_manager,v_team_leader,
    coalesce(v_payload->>'name',v_payload->>'customer_name',v_related->>'name',''),
    coalesce(v_payload->>'phone',v_related->>'phone',''),
    coalesce(v_payload->>'project',v_related->>'project',''),new.id
  );
  return new;
end;
$$;
drop trigger if exists sr_notify_new_lead_record_trg on public.crm_records;
drop trigger if exists sr_notify_new_crm_activity_trg on public.crm_records;
create trigger sr_notify_new_crm_activity_trg
after insert on public.crm_records
for each row execute function public.sr_notify_new_crm_activity();

commit;
