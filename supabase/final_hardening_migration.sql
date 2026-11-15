-- S.R. Developers CRM: final hardening migration
-- Run once in Supabase SQL Editor after ONE_TIME_SETUP.sql,
-- app_cloud_sync_migration.sql and staff_signup_migration.sql.
begin;

alter table public.profiles
  add column if not exists team_leader_id uuid references public.profiles(id);

create index if not exists profiles_manager_id_idx on public.profiles(manager_id);
create index if not exists profiles_team_leader_id_idx on public.profiles(team_leader_id);

-- A manager can see all descendants; a team leader can see assigned executives.
create or replace function public.is_in_my_team(target uuid)
returns boolean
language sql stable security definer
set search_path=public,auth
as $$
  with recursive team(id) as (
    select p.id
    from public.profiles p
    where p.is_active=true
      and (p.manager_id=auth.uid() or p.team_leader_id=auth.uid())
    union
    select p.id
    from public.profiles p
    join team t on (p.manager_id=t.id or p.team_leader_id=t.id)
    where p.is_active=true
  )
  select exists(select 1 from team where id=target)
$$;

create or replace function public.can_access_profile(target uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
  select public.is_admin() or target=auth.uid() or public.is_in_my_team(target)
$$;

drop policy if exists profiles_read_scope on public.profiles;
create policy profiles_read_scope on public.profiles for select to authenticated
using (public.can_access_profile(id));

-- Cloud rows inherit their staff ownership; manager and team-leader access
-- follows the profile reporting tree. Admin retains company-wide access.
drop policy if exists crm_records_read_scope on public.crm_records;
create policy crm_records_read_scope on public.crm_records for select to authenticated
using (public.is_admin() or created_by=auth.uid() or owner_id=auth.uid() or public.is_in_my_team(owner_id));

drop policy if exists crm_records_insert_scope on public.crm_records;
create policy crm_records_insert_scope on public.crm_records for insert to authenticated
with check (
  created_by=auth.uid()
  and (owner_id=auth.uid() or public.is_admin() or public.is_in_my_team(owner_id))
);

drop policy if exists crm_records_update_scope on public.crm_records;
create policy crm_records_update_scope on public.crm_records for update to authenticated
using (public.is_admin() or created_by=auth.uid() or owner_id=auth.uid() or public.is_in_my_team(owner_id))
with check (public.is_admin() or created_by=auth.uid() or owner_id=auth.uid() or public.is_in_my_team(owner_id));

drop policy if exists crm_records_delete_scope on public.crm_records;
create policy crm_records_delete_scope on public.crm_records for delete to authenticated
using (public.is_admin() or created_by=auth.uid());

grant execute on function public.is_in_my_team(uuid) to authenticated;
grant execute on function public.can_access_profile(uuid) to authenticated;

-- Prevent two active booking records for the same project + plot/unit.
-- If this fails, resolve duplicate active bookings first; it will not delete data.
create unique index if not exists crm_active_plot_booking_unique
on public.crm_records ((lower(payload->>'project')), (lower(payload->>'unit')))
where record_type='booking'
  and coalesce(lower(payload->>'status'),'') not in ('cancelled','rejected','lost');

commit;
