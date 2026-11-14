# S.R. Developers CRM — Role Access Setup

1. Open Supabase Dashboard → SQL Editor.
2. Confirm the existing base schema has been applied.
3. Run `role_access_migration.sql`.
4. In `profiles`, set each employee's `manager_id` to their Manager's profile UUID. The Manager must have role `manager`; Admin has role `admin`; sales staff have role `sales_executive`.
5. Assign every Lead's `assigned_to` to the responsible Sales Executive. A manager sees their own leads and leads assigned to direct reports.
6. Test with separate Admin, Manager and Executive accounts before importing real customer records.

## Permissions
- Admin: all profiles, leads and related activity.
- Manager: own profile plus direct reports; own leads and direct reports' assigned leads; their follow-ups, site visits, bookings and call logs.
- Sales Executive: own profile and only leads assigned to them, plus activity related to those leads.
- Call reporting: `call_logs` stores manually logged call activity. This migration does not silently record calls from the Android phone dialer.

## Important
- This migration changes database policies, but does not by itself connect the current localStorage-only front end to Supabase. Shared login and live cross-device data sync require the next app integration step.
- Do not put an `sb_secret_` or service_role key in browser or Android client code. Use only the Supabase Publishable key.
- Manager visibility is based on direct reports (`profiles.manager_id`). If you use team leaders or multiple levels, the hierarchy needs a deliberate extension and separate testing.
