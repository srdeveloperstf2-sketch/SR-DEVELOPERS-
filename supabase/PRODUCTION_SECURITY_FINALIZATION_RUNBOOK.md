# S.R. Developers CRM — Production Security Finalization Runbook

Project ref: amzqgvyslzvhcilawunc
Repository: srdeveloperstf2-sketch/SR-DEVELOPERS-
Last source security commit: 9fa285df

## Current deployment facts
- GitHub Pages deployment for commit 6dbc7043: successful.
- Android APK workflow for commit 6dbc7043: successful.
- SQL files in this repository are source migrations only; this runbook does not claim they have been applied to the live Supabase project.
- Edge Functions in this repository require an authenticated/manual deployment to the Supabase project unless a deployment workflow is configured and its secrets verified.

## Safety gates before live SQL
1. Open Supabase Dashboard for project amzqgvyslzvhcilawunc.
2. Confirm project ref and production environment.
3. Take/verify a database backup or point-in-time restore availability.
4. In SQL Editor, run the Preflight section as SELECT-only first. Stop and review if any required table, column, helper, or policy is missing.
5. Review existing policies and table owners before applying; migrations below replace named policies/functions.
6. Apply only after the schema and policy preflight passes. Do not run initial setup or seed migrations against production.

## Preflight — SELECT-only inspection
```sql
select current_database(), current_user, now();

select table_name
from information_schema.tables
where table_schema='public'
  and table_name in ('profiles','leads','followups','site_visits','bookings','crm_records','attendance','targets','team_messages','leave_requests')
order by table_name;

select table_name, column_name, data_type
from information_schema.columns
where table_schema='public'
and table_name in ('profiles','leads','followups','site_visits','bookings','crm_records','attendance','targets','team_messages','leave_requests')
order by table_name, ordinal_position;

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname='public'
and tablename in ('profiles','leads','followups','site_visits','bookings','crm_records','attendance','targets','team_messages','leave_requests')
order by tablename, policyname;
```

## Migration order (only after preflight + backup)
1. Confirm foundational migrations already applied: schema/ONE_TIME_SETUP, role_access_migration, app_cloud_sync_migration, staff_signup_migration, final_hardening_migration, staff_control_center_migration, and rls_team_scope_consistency_patch as applicable to the live schema.
2. Apply `rls_inactive_staff_access_guard.sql`.
3. Apply the current `rls_inactive_staff_extended_guard.sql` (includes separate targets read/insert/update/delete policies; commit 9fa285df).
4. Do not rerun seed/setup scripts. If any policy names differ from live, stop and reconcile rather than blindly dropping/recreating.

## Edge Function deployment
Deploy `admin-toggle-staff-status` and `admin-reset-staff-password` only after verifying function source, environment and project:
```bash
supabase link --project-ref amzqgvyslzvhcilawunc
supabase functions deploy admin-toggle-staff-status --project-ref amzqgvyslzvhcilawunc
supabase functions deploy admin-reset-staff-password --project-ref amzqgvyslzvhcilawunc
```
Do not paste or commit Supabase service-role/secret keys. Use Supabase dashboard secrets or secure CLI login. Both functions verify caller identity and active Admin profile internally; retain this check.

## Required manual acceptance tests (use dedicated test accounts)
- Active Admin can disable a non-Admin staff test account.
- Disabled account is banned from sign-in; profile is inactive; password was rotated.
- Disabled account's already-open app cannot read/write protected RLS tables (profiles, leads, child activities, CRM cloud records, attendance, targets, messages, leave requests).
- Admin cannot disable self or another Admin from Staff Control.
- Admin can reactivate staff; the employee receives a new password reset before sign-in.
- Manager can read/update targets in their authorized hierarchy; cannot read or change outside hierarchy.
- Team Leader can access only authorized team hierarchy.
- Sales Executive can access self/assigned leads only.
- Test CRUD on targets (create, read, update, delete) under role matrix; deletion must fail for non-Admin.
- Check Edge Function logs for errors and confirm rollback behavior after forced failure in a test environment.

## Session/token limitation
Supabase Auth bans and password rotation do not guarantee instant invalidation of already-issued JWT access tokens. Active-profile checks in RLS block protected database access for inactive profiles. Test all non-RLS endpoints, storage rules, realtime subscriptions, and any server functions too. Do not advertise instant logout until all protected paths validate active status or session revocation.

## Production sign-off
- [ ] Backup/restore point verified
- [ ] Preflight reviewed
- [ ] Inactive-staff SQL applied and policies inspected
- [ ] Edge Functions deployed to correct project
- [ ] Function secrets configured
- [ ] Admin deactivate/reactivate test
- [ ] Inactive account read/write tests
- [ ] Role hierarchy and targets CRUD tests
- [ ] Edge Function logs clean
- [ ] Website + Android smoke tests
