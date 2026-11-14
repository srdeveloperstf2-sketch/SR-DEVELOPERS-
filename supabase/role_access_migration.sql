-- S.R. Developers CRM: role-based access + call activity
-- Run this migration in Supabase SQL Editor AFTER schema.sql.
-- Access model: Admin = all; Manager = direct reports (profiles.manager_id); Executive = assigned leads only.

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public,auth as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin' and p.is_active=true)
$$;

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path=public,auth as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='manager' and p.is_active=true)
$$;

create or replace function public.can_access_profile(target uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
 select public.is_admin() or target=auth.uid() or
 (public.is_manager() and exists(select 1 from public.profiles p where p.id=target and p.manager_id=auth.uid() and p.is_active=true))
$$;

create or replace function public.can_access_lead(target uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
 select public.is_admin() or exists(
   select 1 from public.leads l
   where l.id=target and (
     l.assigned_to=auth.uid() or
     (public.is_manager() and (
       l.assigned_to in (select p.id from public.profiles p where p.manager_id=auth.uid() and p.is_active=true)
       or l.created_by=auth.uid()
     ))
   )
 )
$$;

-- Profiles: staff can see only themselves; managers see direct reports; admin sees all.
drop policy if exists profiles_read_scope on public.profiles;
create policy profiles_read_scope on public.profiles for select to authenticated
using (public.can_access_profile(id));

-- Leads: executives see assigned leads; managers see their own and their direct team's assigned leads.
drop policy if exists leads_read_scope on public.leads;
create policy leads_read_scope on public.leads for select to authenticated
using (public.can_access_lead(id));

drop policy if exists leads_insert_self on public.leads;
create policy leads_insert_self on public.leads for insert to authenticated
with check (
 created_by=auth.uid() and (
   assigned_to=auth.uid() or public.is_admin() or
   (public.is_manager() and assigned_to in (select p.id from public.profiles p where p.manager_id=auth.uid() and p.is_active=true))
 )
);

drop policy if exists leads_update_scope on public.leads;
create policy leads_update_scope on public.leads for update to authenticated
using (public.can_access_lead(id))
with check (
 public.is_admin() or assigned_to=auth.uid() or
 (public.is_manager() and (assigned_to=auth.uid() or assigned_to in (select p.id from public.profiles p where p.manager_id=auth.uid() and p.is_active=true)))
);

drop policy if exists leads_delete_admin on public.leads;
create policy leads_delete_admin on public.leads for delete to authenticated using(public.is_admin());

-- Related activity inherits access from its parent lead.
drop policy if exists followups_scope on public.followups;
create policy followups_scope on public.followups for all to authenticated
using (public.can_access_lead(lead_id))
with check (created_by=auth.uid() and public.can_access_lead(lead_id));

drop policy if exists visits_scope on public.site_visits;
create policy visits_scope on public.site_visits for all to authenticated
using (public.can_access_lead(lead_id))
with check (created_by=auth.uid() and public.can_access_lead(lead_id));

drop policy if exists bookings_scope on public.bookings;
create policy bookings_scope on public.bookings for all to authenticated
using (public.can_access_lead(lead_id))
with check (created_by=auth.uid() and public.can_access_lead(lead_id));

drop policy if exists targets_scope on public.targets;
create policy targets_scope on public.targets for all to authenticated
using (public.is_admin() or (public.is_manager() and public.can_access_profile(user_id)) or user_id=auth.uid())
with check (created_by=auth.uid() and (public.is_admin() or public.is_manager()));

-- Team messages: admin and managers can see all company updates; executives see only their own messages.
drop policy if exists messages_read on public.team_messages;
create policy messages_read on public.team_messages for select to authenticated
using (public.is_admin() or sender_id=auth.uid() or exists(select 1 from public.profiles p where p.id=sender_id and p.manager_id=auth.uid() and public.is_manager()));

-- Call activity for auditable call reporting (manual log; phone dialer integration is separate).
create table if not exists public.call_logs (
 id uuid primary key default gen_random_uuid(),
 lead_id uuid not null references public.leads(id) on delete cascade,
 caller_id uuid not null references public.profiles(id),
 called_at timestamptz not null default now(),
 duration_seconds integer not null default 0 check(duration_seconds>=0),
 outcome text not null default 'connected',
 notes text,
 created_at timestamptz not null default now()
);
alter table public.call_logs enable row level security;
drop policy if exists call_logs_scope on public.call_logs;
create policy call_logs_scope on public.call_logs for select to authenticated
using (public.can_access_lead(lead_id));
drop policy if exists call_logs_insert_self on public.call_logs;
create policy call_logs_insert_self on public.call_logs for insert to authenticated
with check (caller_id=auth.uid() and public.can_access_lead(lead_id));
drop policy if exists call_logs_update_self on public.call_logs;
create policy call_logs_update_self on public.call_logs for update to authenticated
using (caller_id=auth.uid() or public.is_admin())
with check (caller_id=auth.uid() or public.is_admin());
drop policy if exists call_logs_delete_admin on public.call_logs;
create policy call_logs_delete_admin on public.call_logs for delete to authenticated
using (public.is_admin());

grant select,insert,update,delete on public.call_logs to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_manager() to authenticated;
grant execute on function public.can_access_profile(uuid) to authenticated;
grant execute on function public.can_access_lead(uuid) to authenticated;

-- Useful report indexes
create index if not exists leads_assigned_to_idx on public.leads(assigned_to);
create index if not exists profiles_manager_id_idx on public.profiles(manager_id);
create index if not exists followups_due_at_idx on public.followups(due_at);
create index if not exists site_visits_scheduled_at_idx on public.site_visits(scheduled_at);
create index if not exists bookings_booking_date_idx on public.bookings(booking_date);
create index if not exists call_logs_called_at_idx on public.call_logs(called_at);

-- Per-employee activity totals. security_invoker ensures underlying RLS is applied.
create or replace view public.employee_activity_summary
with (security_invoker=true) as
select
 p.id as employee_id,
 p.full_name,
 p.role,
 count(distinct l.id) filter (where l.id is not null) as assigned_leads,
 (select count(*) from public.call_logs cl where cl.caller_id=p.id) as calls_logged,
 (select count(*) from public.followups f join public.leads fl on fl.id=f.lead_id where f.created_by=p.id and public.can_access_lead(fl.id)) as followups_logged,
 (select count(*) from public.site_visits sv join public.leads sl on sl.id=sv.lead_id where sv.created_by=p.id and public.can_access_lead(sl.id)) as site_visits_logged,
 (select count(*) from public.bookings b join public.leads bl on bl.id=b.lead_id where b.created_by=p.id and public.can_access_lead(bl.id)) as bookings_logged
from public.profiles p
left join public.leads l on l.assigned_to=p.id
where p.is_active=true
group by p.id,p.full_name,p.role;

grant select on public.employee_activity_summary to authenticated;
