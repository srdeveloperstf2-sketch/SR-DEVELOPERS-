# S.R. Developers CRM — Final Activation Checklist

## Important protection
- Existing Admin Auth user, email, password and Admin profile are not changed by the additive migrations below.
- Do not run `ONE_TIME_SETUP.sql` again on an existing database.
- Take a Supabase database backup before applying any migration.
- A successful GitHub Pages build does not execute SQL or deploy Supabase Edge Functions.

## A. Database migrations (Supabase Dashboard → SQL Editor)

For a fresh, empty Supabase project, run the base setup once:
1. `ONE_TIME_SETUP.sql`

For an already initialized project, first check which migrations have already been applied. Do not rerun the base setup blindly. Apply only missing migrations in this order:

1. `app_cloud_sync_migration.sql` — shared CRM records for cloud sync.
2. `staff_signup_migration.sql` — employee registration requests and Admin approval.
3. `employee_identity_migration.sql` — sequential SRD Employee IDs for newly created staff.
4. `final_hardening_migration.sql` — Manager → Team Leader → Executive reporting-tree access and duplicate active plot-booking protection.
5. `staff_control_center_migration.sql` — Leave Requests table and Attendance indexes.
6. `partner_signup_migration.sql` and `partner_portal_migration.sql` — Channel Partner records and portal policies, after checking whether either migration was already applied.
7. `project_media_storage_migration.sql` — project photo/video Storage bucket and access policies.

Do not apply a migration if its objects/policies already exist unless it is explicitly written to be safely repeatable. Review any SQL error before proceeding; never delete existing customer or booking records to make a migration pass.

### Payments
The current app stores payment entries in the `payments` collection inside `crm_records` (record_type `payment`). A separate `public.payments` table is not required for the current app flow. The cloud-sync migration must be active for those payment entries to sync between devices.

## B. Supabase Edge Functions

Deploy from a trusted computer with Supabase CLI linked to project `amzqgvyslzvhcilawunc`:

```bash
supabase functions deploy create-staff-login
supabase functions deploy login-with-employee-code
supabase functions deploy create-partner-login
```

- Keep the service-role/secret key only in Supabase Edge Function Secrets.
- Never put a service-role key in `supabase/config.js`, GitHub source, a browser, or chat.
- `login-with-employee-code` is configured with `verify_jwt = false` in `config.toml`; deploy with the project config so this setting is respected.
- GitHub commits alone do not deploy Edge Functions.

## C. Required verification (test accounts only)

1. Existing Admin email/password login still works; Admin role and profile remain unchanged.
2. Create one test employee from Admin → Team → Staff Login ID Management.
3. Confirm SRD Employee ID generation, six-digit temporary password, Employee ID login and registered-mobile login.
4. Confirm Manager, Team Leader and Sales Executive see only their permitted reporting-tree records.
5. Test lead creation, follow-up, site visit, booking and duplicate active plot/unit protection.
6. Test attendance check-in/check-out and leave request submission + approval/rejection.
7. Test payment entry syncs to a second signed-in device.
8. Test project photo/video upload and public preview only after Storage migration.
9. Test Channel Partner approval, partner login, own-lead visibility and commission visibility.
10. Test on two separate phones before entering real customer data.

## D. Release status and limitations

- GitHub Pages deployment is separate from Supabase database and Edge Function setup.
- The Android workflow currently creates a debug APK, not a production-signed release.
- Password recovery depends on Supabase Auth Site URL / Redirect URLs and working email delivery.
- Android reminders must be tested on the installed app with notification permissions enabled.
