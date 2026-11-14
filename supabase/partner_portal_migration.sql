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
