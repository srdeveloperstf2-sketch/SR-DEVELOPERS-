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
('Aurangabad (Delivered)','Palwal, Haryana','delivered')
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
