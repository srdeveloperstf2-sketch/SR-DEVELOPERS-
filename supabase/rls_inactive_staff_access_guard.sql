-- S.R. Developers CRM: fail-closed RLS for inactive staff sessions.
-- Apply only after role_access_migration.sql and final_hardening_migration.sql.
-- Inactive users may retain a JWT until exp, so every authorization helper
-- used by CRM policies must explicitly require an active staff profile.

begin;

create or replace function public.is_in_my_team(target uuid)
returns boolean
language sql stable security definer
set search_path=public,auth
as $$
  with recursive team(id) as (
    select p.id
    from public.profiles p
    where public.current_role() in ('admin','manager','team_leader')
      and p.is_active=true
      and (p.manager_id=auth.uid() or p.team_leader_id=auth.uid())
    union
    select p.id
    from public.profiles p
    join team t on (p.manager_id=t.id or p.team_leader_id=t.id)
    where p.is_active=true
  )
  select public.current_role() in ('admin','manager','team_leader')
    and exists(select 1 from team where id=target)
$$;

create or replace function public.can_access_profile(target uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
  select public.current_role() is not null
    and (public.is_admin() or target=auth.uid() or public.is_in_my_team(target))
$$;

create or replace function public.can_access_lead(target uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
  select public.current_role() is not null and (
    public.is_admin() or exists(
      select 1 from public.leads l
      where l.id=target and (
        l.assigned_to=auth.uid()
        or l.created_by=auth.uid()
        or public.is_in_my_team(l.assigned_to)
      )
    )
  )
$$;

drop policy if exists leads_read_scope on public.leads;
create policy leads_read_scope on public.leads for select to authenticated
using (public.can_access_lead(id));

-- Remove direct owner/creator bypasses from legacy tables: all child records
-- must inherit active-user and parent-lead access checks.
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

grant execute on function public.is_in_my_team(uuid) to authenticated;
grant execute on function public.can_access_profile(uuid) to authenticated;
grant execute on function public.can_access_lead(uuid) to authenticated;

commit;
