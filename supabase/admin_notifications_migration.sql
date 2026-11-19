-- S.R. Developers CRM: Admin activity notifications
-- Run once in Supabase SQL Editor. Existing CRM records and profiles are not modified.

begin;

create table if not exists public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('staff_signup','staff_joined','lead_created')),
  title text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text,
  actor_role text,
  employee_name text,
  employee_phone text,
  employee_role text,
  owner_id uuid references public.profiles(id) on delete set null,
  owner_name text,
  manager_name text,
  team_leader_name text,
  customer_name text,
  customer_phone text,
  project_name text,
  record_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists admin_notifications_recipient_created_idx
  on public.admin_notifications(recipient_id, created_at desc);
create index if not exists admin_notifications_unread_idx
  on public.admin_notifications(recipient_id, read_at)
  where read_at is null;

alter table public.admin_notifications enable row level security;
drop policy if exists admin_notifications_read_own on public.admin_notifications;
create policy admin_notifications_read_own on public.admin_notifications
  for select to authenticated
  using (recipient_id = auth.uid() and (public.is_admin() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('manager','team_leader') and p.is_active = true)));

drop policy if exists admin_notifications_update_own on public.admin_notifications;
create policy admin_notifications_update_own on public.admin_notifications
  for update to authenticated
  using (recipient_id = auth.uid() and (public.is_admin() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('manager','team_leader') and p.is_active = true)))
  with check (recipient_id = auth.uid() and (public.is_admin() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('manager','team_leader') and p.is_active = true)));

grant select, update on public.admin_notifications to authenticated;

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
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.admin_notifications(
    recipient_id,event_type,title,actor_id,actor_name,actor_role,
    employee_name,employee_phone,employee_role,owner_id,owner_name,
    manager_name,team_leader_name,customer_name,customer_phone,
    project_name,record_id
  )
  select p.id,p_event_type,p_title,p_actor_id,p_actor_name,p_actor_role,
    p_employee_name,p_employee_phone,p_employee_role,p_owner_id,p_owner_name,
    p_manager_name,p_team_leader_name,p_customer_name,p_customer_phone,
    p_project_name,p_record_id
  from public.profiles p
  where p.role in ('admin','manager','team_leader') and p.is_active=true;
end;
$$;

create or replace function public.sr_notify_new_staff_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manager text;
  v_team_leader text;
begin
  if new.is_active then
    select full_name into v_manager from public.profiles where id=new.manager_id;
    select full_name into v_team_leader from public.profiles where id=new.team_leader_id;
    perform public.sr_notify_admins(
      'staff_joined','नया कर्मचारी CRM में जुड़ा',
      new.id,new.full_name,new.role,new.full_name,new.phone,new.role,
      new.id,new.full_name,v_manager,v_team_leader,
      null,null,null,new.id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists sr_notify_new_staff_profile_trg on public.profiles;
create trigger sr_notify_new_staff_profile_trg
after insert on public.profiles
for each row execute function public.sr_notify_new_staff_profile();

create or replace function public.sr_notify_new_signup_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sr_notify_admins(
    'staff_signup','नई कर्मचारी Registration Request',
    null,new.full_name,new.requested_role,new.full_name,new.phone,new.requested_role,
    null,null,null,null,null,null,null,new.id
  );
  return new;
end;
$$;

drop trigger if exists sr_notify_new_signup_request_trg on public.staff_signup_requests;
create trigger sr_notify_new_signup_request_trg
after insert on public.staff_signup_requests
for each row execute function public.sr_notify_new_signup_request();

create or replace function public.sr_notify_new_lead_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_owner public.profiles%rowtype;
  v_manager text;
  v_team_leader text;
  v_payload jsonb;
begin
  if new.record_type <> 'lead' then
    return new;
  end if;

  v_payload := coalesce(new.payload,'{}'::jsonb);
  select * into v_actor from public.profiles where id=new.created_by;
  select * into v_owner from public.profiles where id=new.owner_id;
  if v_owner.manager_id is not null then
    select full_name into v_manager from public.profiles where id=v_owner.manager_id;
  end if;
  if v_owner.team_leader_id is not null then
    select full_name into v_team_leader from public.profiles where id=v_owner.team_leader_id;
  elsif v_owner.role='team_leader' then
    v_team_leader := v_owner.full_name;
  end if;

  perform public.sr_notify_admins(
    'lead_created','नई Lead CRM में जोड़ी गई',
    new.created_by,v_actor.full_name,v_actor.role,
    null,null,null,new.owner_id,v_owner.full_name,v_manager,v_team_leader,
    coalesce(v_payload->>'name','ग्राहक नाम उपलब्ध नहीं'),
    coalesce(v_payload->>'phone',''),
    coalesce(v_payload->>'project',''),
    new.id
  );
  return new;
end;
$$;

drop trigger if exists sr_notify_new_lead_record_trg on public.crm_records;
create trigger sr_notify_new_lead_record_trg
after insert on public.crm_records
for each row execute function public.sr_notify_new_lead_record();

do $$
begin
  alter publication supabase_realtime add table public.admin_notifications;
exception when duplicate_object then
  null;
when undefined_object then
  raise notice 'supabase_realtime publication not found; notifications still work with periodic refresh.';
end;
$$;

commit;
