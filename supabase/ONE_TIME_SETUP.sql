-- S.R. DEVELOPERS CRM — ONE-TIME DATABASE SETUP
-- Run this complete file once in Supabase SQL Editor for a fresh project.
-- If you have already run any of these migrations, do not blindly rerun this bundle;
-- use the individual migration files or ask for a safe upgrade sequence.



-- ============================================================
-- 01 — Base CRM schema
-- Source: supabase/schema.sql
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text not null,
 role text not null check (role in ('admin','manager','team_leader','sales_executive')),
 phone text,
 manager_id uuid references public.profiles(id),
 team_leader_id uuid references public.profiles(id),
 is_active boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists public.projects (
 id uuid primary key default gen_random_uuid(),
 name text not null unique,
 location text,
 status text not null default 'active',
 created_at timestamptz not null default now()
);
create table if not exists public.leads (
 id uuid primary key default gen_random_uuid(),
 customer_name text not null,
 phone text not null,
 email text,
 project_id uuid references public.projects(id),
 source text,
 budget numeric,
 status text not null default 'new' check(status in ('new','contacted','qualified','site_visit','negotiation','booked','lost')),
 notes text,
 assigned_to uuid references public.profiles(id),
 created_by uuid not null references public.profiles(id),
 next_follow_up date,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.followups (
 id uuid primary key default gen_random_uuid(),
 lead_id uuid not null references public.leads(id) on delete cascade,
 due_at timestamptz not null,
 outcome text,
 notes text,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now()
);
create table if not exists public.site_visits (
 id uuid primary key default gen_random_uuid(),
 lead_id uuid not null references public.leads(id) on delete cascade,
 scheduled_at timestamptz not null,
 status text not null default 'planned',
 notes text,
 assigned_to uuid references public.profiles(id),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now()
);
create table if not exists public.bookings (
 id uuid primary key default gen_random_uuid(),
 lead_id uuid not null references public.leads(id),
 project_id uuid references public.projects(id),
 plot_or_unit text,
 amount numeric,
 booking_date date not null default current_date,
 status text not null default 'reserved',
 notes text,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now()
);
create table if not exists public.targets (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id),
 period_start date not null,
 period_end date not null,
 lead_target integer not null default 0,
 visit_target integer not null default 0,
 booking_target integer not null default 0,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now()
);
create table if not exists public.team_messages (
 id uuid primary key default gen_random_uuid(),
 sender_id uuid not null references public.profiles(id),
 body text not null,
 created_at timestamptz not null default now()
);

insert into public.projects(name,location,status) values
('Hilalpur Township','Hilalpur, Near Sohna, Gurugram, Haryana','active'),
('Mandawar Society','Mandawar, Near IMT Sohna, Gurugram, Haryana','active'),
('S.R. City (Tappal)','Tappal, Aligarh, Uttar Pradesh','active'),
('Ayodhya Project','Darshan Nagar Rasoolabad Road, Ayodhya, Uttar Pradesh','active'),
('Banchari Project','Between Palwal and Hodal, Haryana','active'),
('Sondh Project','Near Hodal, Haryana','active'),
('Aurangabad (Delivered)','Palwal, Haryana','delivered'),
('Galaxy 1 (IMT Sohna)','IMT Sohna, Gurugram, Haryana','active')
on conflict(name) do nothing;

create or replace function public.current_role() returns text language sql stable security definer set search_path=public as $$
 select role from public.profiles where id=auth.uid() and is_active=true
$$;
create or replace function public.can_access_profile(target uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.profiles p where p.id=target and (
  p.id=auth.uid() or public.current_role()='admin' or
  (public.current_role()='manager' and p.manager_id=auth.uid()) or
  (public.current_role()='team_leader' and p.team_leader_id=auth.uid())
 ))
$$;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.leads enable row level security;
alter table public.followups enable row level security;
alter table public.site_visits enable row level security;
alter table public.bookings enable row level security;
alter table public.targets enable row level security;
alter table public.team_messages enable row level security;

drop policy if exists profiles_read_scope on public.profiles;
create policy profiles_read_scope on public.profiles for select to authenticated using (public.can_access_profile(id) or public.current_role()='admin');
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles for all to authenticated using(public.current_role()='admin') with check(public.current_role()='admin');
drop policy if exists projects_read on public.projects;
create policy projects_read on public.projects for select to authenticated using(true);
drop policy if exists projects_admin_write on public.projects;
create policy projects_admin_write on public.projects for all to authenticated using(public.current_role()='admin') with check(public.current_role()='admin');

drop policy if exists leads_read_scope on public.leads;
create policy leads_read_scope on public.leads for select to authenticated using (
 public.current_role()='admin' or assigned_to=auth.uid() or created_by=auth.uid() or
 exists(select 1 from public.profiles p where p.id=assigned_to and (p.manager_id=auth.uid() or p.team_leader_id=auth.uid()))
);
drop policy if exists leads_insert_self on public.leads;
create policy leads_insert_self on public.leads for insert to authenticated with check(created_by=auth.uid() and (assigned_to=auth.uid() or public.current_role() in ('admin','manager','team_leader')));
drop policy if exists leads_update_scope on public.leads;
create policy leads_update_scope on public.leads for update to authenticated using(public.current_role()='admin' or assigned_to=auth.uid() or created_by=auth.uid() or exists(select 1 from public.profiles p where p.id=assigned_to and (p.manager_id=auth.uid() or p.team_leader_id=auth.uid()))) with check(public.current_role()='admin' or assigned_to=auth.uid() or created_by=auth.uid() or exists(select 1 from public.profiles p where p.id=assigned_to and (p.manager_id=auth.uid() or p.team_leader_id=auth.uid())));
drop policy if exists leads_delete_admin on public.leads;
create policy leads_delete_admin on public.leads for delete to authenticated using(public.current_role()='admin');

drop policy if exists followups_scope on public.followups;
create policy followups_scope on public.followups for all to authenticated using(exists(select 1 from public.leads l where l.id=lead_id and (public.current_role()='admin' or l.assigned_to=auth.uid() or l.created_by=auth.uid() or exists(select 1 from public.profiles p where p.id=l.assigned_to and (p.manager_id=auth.uid() or p.team_leader_id=auth.uid()))))) with check(created_by=auth.uid());
drop policy if exists visits_scope on public.site_visits;
create policy visits_scope on public.site_visits for all to authenticated using(public.current_role()='admin' or assigned_to=auth.uid() or created_by=auth.uid() or exists(select 1 from public.profiles p where p.id=assigned_to and (p.manager_id=auth.uid() or p.team_leader_id=auth.uid()))) with check(created_by=auth.uid());
drop policy if exists bookings_scope on public.bookings;
create policy bookings_scope on public.bookings for all to authenticated using(public.current_role()='admin' or created_by=auth.uid() or exists(select 1 from public.leads l where l.id=lead_id and (l.assigned_to=auth.uid() or l.created_by=auth.uid()))) with check(created_by=auth.uid());
drop policy if exists targets_scope on public.targets;
create policy targets_scope on public.targets for all to authenticated using(public.current_role()='admin' or user_id=auth.uid() or public.can_access_profile(user_id)) with check(public.current_role() in ('admin','manager','team_leader') and created_by=auth.uid());
drop policy if exists messages_read on public.team_messages;
create policy messages_read on public.team_messages for select to authenticated using(true);
drop policy if exists messages_insert on public.team_messages;
create policy messages_insert on public.team_messages for insert to authenticated with check(sender_id=auth.uid());

grant usage on schema public to authenticated;
grant select,insert,update,delete on public.profiles,public.projects,public.leads,public.followups,public.site_visits,public.bookings,public.targets,public.team_messages to authenticated;


create table if not exists public.attendance (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id), attendance_date date not null default current_date, check_in timestamptz, check_out timestamptz, notes text, created_at timestamptz not null default now(), unique(user_id,attendance_date), check(check_out is null or check_in is not null), check(check_out is null or check_out >= check_in));
alter table public.attendance enable row level security;
drop policy if exists attendance_read_scope on public.attendance;
create policy attendance_read_scope on public.attendance for select to authenticated using (public.current_role()='admin' or user_id=auth.uid() or public.can_access_profile(user_id));
drop policy if exists attendance_insert_self on public.attendance;
create policy attendance_insert_self on public.attendance for insert to authenticated with check(user_id=auth.uid());
drop policy if exists attendance_update_scope on public.attendance;
create policy attendance_update_scope on public.attendance for update to authenticated using (public.current_role()='admin' or user_id=auth.uid()) with check(public.current_role()='admin' or user_id=auth.uid());
grant select,insert,update on public.attendance to authenticated;

-- Customer enquiry qualification fields (safe to run on existing installations)
alter table public.leads add column if not exists min_budget numeric;
alter table public.leads add column if not exists whatsapp text;
alter table public.leads add column if not exists city text;
alter table public.leads add column if not exists full_address text;
alter table public.leads add column if not exists occupation text;
alter table public.leads add column if not exists company_name text;
alter table public.leads add column if not exists property_type text;
alter table public.leads add column if not exists required_size text;
alter table public.leads add column if not exists purchase_purpose text;
alter table public.leads add column if not exists purchase_timeline text;
alter table public.leads add column if not exists payment_preference text;
alter table public.leads add column if not exists priority text not null default 'warm';
alter table public.leads add column if not exists campaign text;



-- ============================================================
-- 02 — Role-based access and activity reporting
-- Source: supabase/role_access_migration.sql
-- ============================================================

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
using ((caller_id=auth.uid() or public.is_admin()) and public.can_access_lead(lead_id))
with check ((caller_id=auth.uid() or public.is_admin()) and public.can_access_lead(lead_id));
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



-- ============================================================
-- 03 — Channel Partner / Broker Portal
-- Source: supabase/partner_portal_migration.sql
-- ============================================================

-- S.R. Developers: secure Broker / Channel Partner portal
-- Run AFTER schema.sql and role_access_migration.sql.
create table if not exists public.channel_partners (
 id uuid primary key default gen_random_uuid(),
 partner_code text not null unique,
 full_name text not null,
 phone text,
 firm_name text,
 partner_type text not null default 'Individual Broker',
 project_scope text[] not null default '{}',
 commission_percent numeric(5,2) not null default 0 check (commission_percent between 0 and 100),
 relationship_manager uuid references public.profiles(id),
 area text,
 status text not null default 'pending' check(status in ('pending','active','inactive','suspended')),
 auth_user_id uuid unique references auth.users(id) on delete set null,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now()
);
alter table public.leads add column if not exists channel_partner_id uuid references public.channel_partners(id);
create index if not exists leads_channel_partner_id_idx on public.leads(channel_partner_id);
create index if not exists channel_partners_status_idx on public.channel_partners(status);

create table if not exists public.partner_commissions (
 id uuid primary key default gen_random_uuid(),
 partner_id uuid not null references public.channel_partners(id),
 booking_id uuid not null references public.bookings(id),
 gross_amount numeric(14,2) not null check(gross_amount>=0),
 commission_percent numeric(5,2) not null check(commission_percent between 0 and 100),
 commission_amount numeric(14,2) not null check(commission_amount>=0),
 status text not null default 'pending' check(status in ('pending','approved','paid','on_hold','rejected')),
 due_date date,
 paid_at timestamptz,
 payment_reference text,
 notes text,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now()
);
create index if not exists partner_commissions_partner_idx on public.partner_commissions(partner_id);

alter table public.channel_partners enable row level security;
alter table public.partner_commissions enable row level security;

create or replace function public.is_partner()
returns boolean language sql stable security definer set search_path=public,auth as $$
 select exists(select 1 from public.channel_partners cp where cp.auth_user_id=auth.uid() and cp.status='active')
$$;
create or replace function public.current_partner_id()
returns uuid language sql stable security definer set search_path=public,auth as $$
 select cp.id from public.channel_partners cp where cp.auth_user_id=auth.uid() and cp.status='active' limit 1
$$;

drop policy if exists channel_partners_read on public.channel_partners;
create policy channel_partners_read on public.channel_partners for select to authenticated
using (public.is_admin() or public.is_manager() or auth_user_id=auth.uid());
drop policy if exists channel_partners_admin_write on public.channel_partners;
create policy channel_partners_admin_write on public.channel_partners for all to authenticated
using (public.is_admin()) with check (public.is_admin());

-- Partner can read only their own enquiries; staff policies remain intact.
drop policy if exists leads_read_scope on public.leads;
create policy leads_read_scope on public.leads for select to authenticated
using (public.is_admin() or public.can_access_lead(id) or
 (public.is_partner() and channel_partner_id=public.current_partner_id()));
-- Separate partner-submitted enquiry table: partner accounts are not staff profiles.
create table if not exists public.partner_leads (
 id uuid primary key default gen_random_uuid(),
 partner_id uuid not null references public.channel_partners(id),
 customer_name text not null,
 phone text not null,
 project_name text,
 requirement text,
 budget numeric(14,2),
 notes text,
 status text not null default 'new' check(status in ('new','contacted','qualified','site_visit','booked','lost')),
 created_at timestamptz not null default now()
);
create index if not exists partner_leads_partner_idx on public.partner_leads(partner_id);
alter table public.partner_leads enable row level security;
drop policy if exists partner_leads_own_access on public.partner_leads;
create policy partner_leads_own_access on public.partner_leads for all to authenticated
using (public.is_admin() or (public.is_partner() and partner_id=public.current_partner_id()))
with check (public.is_admin() or (public.is_partner() and partner_id=public.current_partner_id()));

drop policy if exists partner_commissions_read on public.partner_commissions;
create policy partner_commissions_read on public.partner_commissions for select to authenticated
using (public.is_admin() or (public.is_partner() and partner_id=public.current_partner_id()));
drop policy if exists partner_commissions_admin_write on public.partner_commissions;
create policy partner_commissions_admin_write on public.partner_commissions for all to authenticated
using (public.is_admin()) with check (public.is_admin());

grant select on public.channel_partners, public.partner_commissions, public.partner_leads to authenticated;
grant insert,update,delete on public.channel_partners, public.partner_commissions, public.partner_leads to authenticated;
