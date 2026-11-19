-- S.R. Developers CRM: unify legacy-table team RLS with recursive hierarchy.
-- Review and apply ONLY after confirming final_hardening_migration.sql is deployed.
-- This migration changes RLS policies only; it does not modify or delete rows.

begin;

-- Lead assignment: staff can assign to self; Admin can assign company-wide;
-- Managers and Team Leaders can assign to active members of their recursive team.
drop policy if exists leads_insert_self on public.leads;
create policy leads_insert_self on public.leads for insert to authenticated
with check (
  created_by=auth.uid()
  and (
    assigned_to=auth.uid()
    or public.is_admin()
    or (
      public.current_role() in ('manager','team_leader')
      and assigned_to is not null
      and public.is_in_my_team(assigned_to)
    )
  )
);

-- Lead updates are permitted only for a Lead the caller can access, and the
-- resulting assignment must remain in their allowed scope.
drop policy if exists leads_update_scope on public.leads;
create policy leads_update_scope on public.leads for update to authenticated
using (public.can_access_lead(id))
with check (
  public.is_admin()
  or assigned_to=auth.uid()
  or created_by=auth.uid()
  or (
    public.current_role() in ('manager','team_leader')
    and assigned_to is not null
    and public.is_in_my_team(assigned_to)
  )
);

-- Child activity must be linked to an accessible parent Lead on both reads and writes.
drop policy if exists followups_scope on public.followups;
create policy followups_scope on public.followups for all to authenticated
using (public.can_access_lead(lead_id))
with check (created_by=auth.uid() and public.can_access_lead(lead_id));

drop policy if exists visits_scope on public.site_visits;
create policy visits_scope on public.site_visits for all to authenticated
using (public.can_access_lead(lead_id))
with check (
  created_by=auth.uid()
  and public.can_access_lead(lead_id)
  and (assigned_to=auth.uid() or assigned_to is null or public.is_admin()
       or (public.current_role() in ('manager','team_leader') and public.is_in_my_team(assigned_to)))
);

drop policy if exists bookings_scope on public.bookings;
create policy bookings_scope on public.bookings for all to authenticated
using (public.can_access_lead(lead_id))
with check (created_by=auth.uid() and public.can_access_lead(lead_id));

commit;
