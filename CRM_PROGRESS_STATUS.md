# S.R. Developers CRM — Project Status & Launch Checklist
Last reviewed: 16 November 2026

## 1. Current application links
- Web app: https://srdeveloperstf2-sketch.github.io/SR-DEVELOPERS-/
- GitHub repository: https://github.com/srdeveloperstf2-sketch/SR-DEVELOPERS-
- Supabase project ID: amzqgvyslzvhcilawunc

## 2. Verified completed work
- Existing CRM repository retained; this is an upgrade of the existing application, not a rebuild.
- Existing Admin login and existing CRM data are to be preserved; no instruction to reset or clear browser storage has been applied.
- Staff login UI has been streamlined for Admin, Manager, Team Leader and Sales Executive; role is intended to be determined by the authenticated profile.
- Separate Channel Partner / Broker portal entry is present in the login design.
- Registration is collapsed by default and can be opened when needed.
- Mobile login layout and contrast were improved; Employee ID and password fields stack on narrow screens.
- Forgot-password email validation was corrected; signup request handler now resets its submit button in a finally block.
- Employee identity migration source adds sequential SRD employee codes for new profiles while leaving existing profiles unchanged.
- Cloud sync write queue now surfaces write failures instead of silently swallowing them; staff-directory load failures now raise an explicit error.
- Service-role secrets are not placed in frontend configuration.
- A separate manual signed-release Android workflow was added; it requires company-owned signing credentials in GitHub Actions Secrets.

## 3. Latest verified GitHub Actions
- GitHub Pages deployment for commit f92519b6: SUCCESS.
  https://github.com/srdeveloperstf2-sketch/SR-DEVELOPERS-/actions/runs/43758989158
- Android Debug APK build for commit 991d496b: SUCCESS.
  https://github.com/srdeveloperstf2-sketch/SR-DEVELOPERS-/actions/runs/43758981036
- Debug APK artifact: SR-Developers-CRM-Android-debug (artifact ID 14179367021). Download from the workflow run's Artifacts section. GitHub artifact retention shown as 15 December 2026.
- These are build/deployment results only; they do not prove successful real-user login, database migration, cloud sync or end-to-end business workflows.

## 4. Not yet verified / outstanding
### Priority 1 — Supabase database
- Obtain a fresh, complete inventory of existing tables, columns, functions, policies and triggers.
- Back up the database before applying any migration.
- Compare the live schema with the migration files before applying missing migrations.
- Do NOT rerun ONE_TIME_SETUP.sql on an existing database.
- Review and apply only missing additive migrations in dependency order; verify each one after execution.
- Confirm RLS policies preserve Admin company-wide access and correctly scope managers, team leaders and employees.
- Confirm the active-plot booking unique index will not be blocked by existing duplicate active bookings.

### Priority 2 — Supabase Edge Functions / authentication
- Confirm create-staff-login, login-with-employee-code and partner-login functions are deployed.
- Confirm required secrets exist in Supabase Function Secrets; never put service-role keys in app code, GitHub files or chat.
- Confirm login-with-employee-code JWT configuration and test employee-code/mobile login without changing the existing Admin account.
- Confirm Supabase Auth Site URL, Redirect URLs and email delivery for password reset.

### Priority 3 — Real-device acceptance tests
- Test existing Admin login first; do not change its credentials.
- Test one approved test employee account and confirm role routing.
- Test employee-code login and registered-mobile login.
- Create a harmless test lead on Phone A; verify it appears on Phone B after sync.
- Update a test follow-up and verify the change propagates.
- Verify a staff member cannot see another team's restricted records.
- Test lead, follow-up, site visit, booking, inventory, payment, partner, attendance and leave workflows.
- Test offline/reconnect behavior and visible error handling.
- Do not use production customer data for destructive tests.

### Priority 4 — Production Android release
- Company must retain its own Android signing keystore and offline backup.
- Add these GitHub Actions Secrets privately: ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD.
- Never send signing passwords or keystore files in chat.
- Run the manual signed-release workflow only after secrets are configured.
- Install and test the signed APK before distribution.

## 5. Launch gate
The web deployment and debug APK build are successful. The application is NOT yet certified production-ready because live Supabase schema/migrations, Edge Function deployment, real Admin/employee login, two-device sync, role-based access and signed APK installation remain unverified.

## 6. Safe next sequence
1. Open the web app and perform an Admin login smoke test using the existing credentials.
2. Capture the current Supabase table/schema inventory and take a backup.
3. Compare schema inventory with migration files; apply only missing migrations.
4. Verify/deploy Edge Functions and required secrets.
5. Run two-device sync and role-permission tests with test accounts.
6. Generate, install and validate the signed Android release.
7. Only then approve staff-wide rollout.


## 7. Follow-up safety audit — 18 November 2026
- Removed the one-click bulk staff reset control from Staff Control. It previously changed every non-Admin staff password and rewrote employee codes from SRD0001; this is not appropriate before the agreed backup/inventory/archive plan.
- Hardened the individual staff-password reset Edge Function: it now refuses Admin profiles and inactive/archived profiles. Existing Admin credentials and inactive trial accounts are protected from this workflow.
- Code commits: staff-control.js `df06434438d86936f201c8947046a887813f923a`; admin-reset-staff-password Edge Function `af0482b306ee8d911b682844f74a369a3bf3a408`.
- GitHub Actions Android APK build and Pages deployment were queued for the latest commit when checked; completion has not yet been verified.
- These are repository code changes only. The Edge Function change still needs deployment to Supabase before it affects the live function. No Supabase database migration, account reset, account deletion, or customer-data modification was performed.

## 8. Immediate next work
1. Finish read-only audit of all staff/auth Edge Functions and RLS migrations.
2. Capture and verify a current Supabase database backup and live schema inventory before any database change.
3. Reconcile Auth users against profiles, preserving all existing trial accounts and CRM records; prepare a proposed archive/deactivation list for Admin approval.
4. Deploy and verify only the reviewed Edge Function changes; then test one approved test employee without touching the existing Admin login.
