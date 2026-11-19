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
4. Review and apply the updated `project_media_storage_migration.sql` storage mutation policies (commit 84d8fad2). Verify the bucket remains public-read intentionally, while upload/update/delete require `public.current_role() is not null`. This migration upserts bucket configuration and replaces its named storage policies; inspect existing storage policies before running it.
5. Do not rerun seed/setup scripts. If any policy names differ from live, stop and reconcile rather than blindly dropping/recreating.

## Login throttling migration
- Apply `employee_login_rate_limit_migration.sql` before deploying the updated `login-with-employee-code` function. It creates a service-role-only RPC and hashed identifier keys; raw identifiers are not stored. The function fails closed if the RPC is unavailable. The throttle is 10 attempts per identifier per 15-minute window; this is a protective baseline, not a substitute for monitoring or captcha on public registration.

## Webhook secret migration (TimelinesAI)
- `timelinesai-webhook` now prefers `x-webhook-secret` header, but temporarily accepts the legacy `?secret=` query to avoid interrupting integration migration. Query use emits a warning without logging the secret.
- Configure TimelinesAI to send `x-webhook-secret: <same WHATSAPP_WEBHOOK_SECRET>`, confirm delivery, then remove query fallback in a later commit. Never put the secret in a URL going forward.

## Account creation and login security notes
- `create-staff-login` now paginates Auth users (up to 100 pages × 1,000) before duplicate-email handling; it fails closed if the safe scan limit is reached. Temporary 6-digit codes in staff creation and password-reset functions use rejection sampling to avoid modulo bias; the short format is retained for compatibility, so rely on Supabase Auth throttling and reset temporary passwords promptly.
- `login-with-employee-code` checks an active CRM profile before password verification and delegates password checking/session creation to Supabase Auth. Confirm Auth rate-limit settings in the live project and test employee-code/mobile/email login, inactive profiles, invalid credentials, and repeated failures.

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


## Reminder / notification permission verification (Android)

- Follow-up and site-visit alarms use Capacitor Local Notifications on the Android wrapper. Verify notifications are enabled for the app under Android Settings > Apps > S.R. DEVELOPERS CRM > Notifications.
- On Android 13+, grant notification permission when prompted. If the app reports permission denied, reminders remain saved in CRM but are not scheduled.
- Check exact-alarm settings when reminders arrive late; exact-alarm access is device/version dependent and must be verified on the target phone.
- Browser notifications are not equivalent to native scheduled alarms; browser fallback timers only work while the page remains alive and must not be treated as reliable background alarms.
- Current Admin Activity notification UI uses realtime and periodic refresh while the app is running. Background push delivery to all staff, leave approval/rejection push, and call/booking notifications require a production push delivery design (e.g. FCM token registration, server-side event triggers, delivery retry/cleanup) and device testing; do not mark these as completed merely because the Admin notification table exists.
- Test matrix: schedule a follow-up and site visit 10 minutes ahead, force-close app, verify alarm sound/vibration and notification action; deny permission and verify record saved but reminder blocked with clear instructions; test Android 13+ and one older Android device.


## Audit continuation (source review; live verification still pending)

### Inactive staff
- Source-reviewed: `current_role()` in ONE_TIME_SETUP/schema returns NULL for inactive profiles; inactive staff RLS guard replaces named scope policies for leads/followups/site_visits/bookings and extended guard gates CRM records, attendance, targets, team messages, and leave requests using active role checks.
- `admin-toggle-staff-status` verifies a valid caller JWT, active Admin profile, rejects self-disable and Admin targets; deactivation bans Auth, marks profile inactive, rotates password; activation unbans then marks active with rollback on profile update failure.
- Before production apply, inspect ALL existing permissive policies (Postgres policies are OR-combined), particularly legacy policies on tables and Storage. The named policy replacement alone cannot prove no other permissive policy grants access.
- Live tests required: deactivate test staff, verify sign-in ban, then with pre-existing session verify reads/writes denied on each protected table, Storage upload/update/delete, Realtime; re-enable and password-reset workflow.

### Login and account creation
- Source-reviewed: employee-code/mobile login checks active profile before Auth sign-in and uses service-role RPC throttle; RPC is fail-closed if migration/RPC unavailable. Current limiter is 10 tries per normalized identifier/15 minutes (identifier-only; not IP keyed). This is susceptible to targeted lockout and needs infrastructure/IP-aware anti-abuse mitigation that does not trust spoofed forwarded headers.
- Staff login creation requires active Admin JWT/profile; accepts only allowlisted roles; pending signup request must exist; manager relationship checked; account/profile/approval/password steps include rollback paths. Duplicate Auth email scan is paginated and fail-closed at scan cap.
- Partner login creation requires active Admin; validates partner record, pending/active status and absence of existing linked login; creates Auth user then links partner with rollback.
- Public staff/partner signup insert policies remain public and do not implement durable per-IP throttling or CAPTCHA. Spam/abuse control is outstanding; add edge/provider rate limiting or CAPTCHA before public release. Partner signup migration reconciliation (source): `partner_signup_requests_migration.sql` is now the canonical strict version for new installs, with required phone, partner-type allowlist, email/phone checks, and pending-email uniqueness. `partner_signup_migration.sql` is marked deprecated and retained for history only. This is NOT yet live-schema-verified: inspect existing columns, constraints, duplicate pending emails, policies and grants before applying or altering production.
- Live tests required: duplicate email/phone/employee code, pending request replay, role escalation attempt, manager ID mismatch, inactive Admin rejection, password reset, throttle after 10 attempts and reset after 15 minutes, account creation rollback.

### Background push
- Source reviewed: notification database/admin activity UI exists; Android local alarms support reminders when permissions granted.
- Background push delivery to Android app when closed is not proven. FCM setup requires Firebase project, Android app registration, Firebase config, server credentials stored as Supabase Edge secrets, device push token registration, server event triggers, delivery retry and device tests. No secrets/configuration should be committed to the repo.
- Required device test: force-close app; deliver test push for follow-up due, leave request/approval, assigned lead/call event; verify tap routes to correct screen; test revoked permissions/token expiry.

### Release gate
- Website CI success does not mean Supabase migrations or Edge Functions are deployed. Android CI success does not prove install/runtime notification behavior.
- Release remains blocked until migration apply/review, Edge Function deployment, policy conflict review, push setup/device test, and role matrix test (Admin, Manager, Team Leader, Sales Executive, Partner) are recorded with evidence.


## Source audit continuation (2026-11-19)

### Reviewed source guards
- `current_role()` returns a role only when the profile is active. Inactive staff RLS policies and the updated CRM/attendance/targets/messages/leave guards use this helper or explicit active checks; this is source-reviewed, not live-policy-tested.
- `admin-toggle-staff-status`: verifies active Admin; prevents self-disable and Admin targets; bans Auth before profile deactivation, rotates password, and keeps account banned/inactive if rotation errors; reactivation requires new password reset. Existing JWTs are not immediately revoked, so all server/non-RLS endpoints and realtime/storage paths still need runtime testing.
- `admin-reset-staff-password`: active Admin only; refuses Admin and inactive targets. 
- `create-staff-login`: active Admin authorization, allowed roles list, duplicate email scan paginated with fail-closed page limit; temporary password generator uses rejection sampling.
- `create-partner-login`: active Admin authorization, partner record/status checks, prevents second login on same partner, rolls back newly created Auth user if partner linking fails. Email uniqueness is still enforced by Auth; test duplicate email and race conditions live.
- Login rate-limit keys now normalize employee codes to uppercase and phone identifiers to canonical +91 mobile form before SHA-256 hashing, so formatted mobile variations share a throttle key. RPC/migration is still not applied in production.

### Remaining critical gaps / blockers
- Public staff/partner registration inserts are allowed by RLS; form validation and pending approval reduce account privilege risk but do not stop spam/flood. Robust anti-abuse (Captcha/Turnstile or rate-limited server endpoint) is not implemented. Do not make public signup unrestricted account creation.
- Background push (FCM) has no verified token-registration, server delivery, credentials/secrets, retry, or device testing in the repository's reviewed path. This cannot be marked completed without Firebase project configuration and secure secrets.
- Notification migrations create in-app/Admin activity records; they are not proof of OS push delivery while the app is closed.
- Partner migration source conflict has been reconciled: `partner_signup_requests_migration.sql` is canonical (strict schema + pending-email uniqueness), while `partner_signup_migration.sql` is deprecated. Production table shape/constraints/policies must still be SELECT-inspected and reconciled before any SQL apply; the canonical file's `CREATE TABLE IF NOT EXISTS` does not retroactively add constraints to an existing table.
- Production Supabase migrations, deployed Edge Functions, webhook header migration, storage policy conflict review, Realtime tests, and role matrix tests are pending.

### Release tests required
1. Disable test staff; attempt fresh login and use pre-existing session against all protected tables, RPC/Edge Functions, storage mutations, realtime.
2. Reactivate and verify login requires newly issued password.
3. Create staff/partner with existing email, concurrent duplicate request, unauthorized role, inactive Admin token, malformed inputs.
4. Test 10 failed/attempts in 15 minutes with employee-code and phone formatting variants; verify RPC and 429 behavior, 503 fail-closed when RPC unavailable.
5. Test follow-up/site visit native alarm after force-close; permission denied; Android exact-alarm setting.
6. Test leave request/approval/rejection in-app notifications, and separately verify FCM push once configured.
7. Test Admin, Manager, Team Leader, Sales Executive, Partner accounts for cross-team/partner isolation and CRUD scopes.


### Partner migration preflight (SELECT-only; production required)
```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema='public' and table_name='partner_signup_requests'
order by ordinal_position;

select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid='public.partner_signup_requests'::regclass;

select indexname, indexdef
from pg_indexes
where schemaname='public' and tablename='partner_signup_requests';

select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname='public' and tablename='partner_signup_requests'
order by policyname;

select lower(email), count(*)
from public.partner_signup_requests
where status='pending'
group by lower(email)
having count(*) > 1;
```


## Final verification checkpoint — 2026-11-19

### CI evidence
- Latest website workflow at checkpoint: Pages #421 — success, commit `fb6e37b8`.
- Latest Android APK workflow at checkpoint: Android #306 — success, commit `fb6e37b8`.
- These establish CI packaging/deployment only, not live Supabase or device behavior.

### FCM source audit result
- Reviewed repository `package.json`, `app.js`, `notifications.js`, `sw.js`, `auth.js`, `cloud-sync.js`, and `index.html`.
- No Firebase/FCM SDK dependency, device-token registration flow, server delivery endpoint, or FCM server-secret configuration is present in the inspected code path.
- Existing `app.js` local reminder scheduling uses Capacitor Local Notifications; `notifications.js` reads admin notification rows and subscribes to Supabase Realtime. These are NOT background OS push delivery when the app is closed.
- FCM implementation must not be marked complete until Android Firebase registration/configuration, token persistence/refresh/cleanup, authenticated server delivery (Firebase Admin/HTTP v1 using secrets), event wiring, failure handling, and physical-device force-close tests are completed. Avoid committing service-account keys.

### Role-based acceptance test matrix — required evidence before release
| Role | Verify allowed | Verify denied |
| Admin | staff control, reports, all approved CRM administration | self-disable; unauthorized cross-service action |
| Manager | assigned/team scoped CRM, team reports, approvals as permitted | unrelated team/partner records |
| Team Leader | own team leads/followups/attendance workflows | other team scope and admin-only controls |
| Sales Executive | own/assigned leads, followups, site visits | staff control, unrelated leads, other team data |
| Partner | own partner profile/leads/approved access | internal staff data, other partners' leads, admin functions |

Record for each: test account role/profile, timestamp, screen/action, expected, actual, result, and sanitized evidence (no passwords/tokens).

### Live environment/device verification — NOT run from repository-only access
- Supabase production backup/PITR confirmation and read-only schema/policy preflight.
- Apply login rate-limit SQL, reconcile canonical partner migration against live schema, apply/review inactive-staff RLS and storage policies, deploy verified Edge Function changes.
- Disable a staff test user and test their existing session against RLS tables, Edge Functions, Realtime and Storage; reactivate and require new password.
- Execute 10-attempt login throttle test and formatting-variant test; verify fail-closed RPC behavior.
- Install latest APK on physical Android device; test login, cloud sync, local reminder permission denial/grant, app force-close reminder behavior.
- FCM: force-close app and test push for at least one event, verify delivery, tap navigation, token refresh/revocation, and invalid-token cleanup.
- Execute role matrix above with real test accounts and isolated test data.
- Regression-test Leads, Follow-ups, Site Visits, Bookings, Payments, Attendance, Partner signup/approval, reports and notifications.

### Release gate status
- Source audit and source changes: progressing/completed for the reviewed patches; do not infer production security verification from source alone.
- Website CI: PASS (#421 at commit fb6e37b8).
- Android CI APK: PASS (#306 at commit fb6e37b8).
- FCM background push: BLOCKED (not implemented/configured/physical-device verified).
- Production SQL migrations: BLOCKED (no production database access/apply evidence).
- Inactive old-session tests: BLOCKED (requires real live session/device).
- Role matrix: BLOCKED (requires dedicated live test accounts).
- Physical Android regression: BLOCKED (device test not recorded).
- Production security verified: NO — release gate remains open.


## FCM background push implementation — source checkpoint 2026-11-19
FCM source has now been scaffolded; it is NOT production configured or device-verified.

### Files added/updated
- `push-client.js`: native Capacitor push permission, Android channel creation, token registration, event forwarding, logout token revocation.
- `supabase/fcm_device_and_queue_migration.sql`: token table, durable job queue, admin notification insert trigger.
- `supabase/functions/register-push-device/index.ts`: validates the authenticated Supabase user and upserts/revokes only that user's device token via service role.
- `supabase/functions/deliver-crm-push/index.ts`: cron-secret protected queue dispatcher, service-account OAuth JWT, FCM HTTP v1, bounded exponential retry, stale-job recovery and invalid-token cleanup.
- `package.json`: adds `@capacitor/push-notifications` v7 line.
- Android workflow copies/checks `push-client.js`; `index.html` loads it.
- `supabase/config.toml`: registration JWT verification on; dispatcher JWT verification off because it uses its own cron secret.

### Production prerequisites (do not paste secrets into Git/chat)
1. Firebase Console: create/register Android app with package ID `in.srdevelopers.crm`; download `google-services.json` to the Android build environment only. Keep it out of public repo unless explicitly confirmed acceptable (Firebase client config is not service secret, but repo exposure should be reviewed).
2. Firebase Cloud Messaging API enabled; create least-privilege service account and store its JSON as Supabase Edge Function secret `FCM_SERVICE_ACCOUNT_JSON`. This key is sensitive. Rotate if exposed.
3. Set Supabase secrets: `FCM_SERVICE_ACCOUNT_JSON`, `PUSH_DISPATCH_SECRET` (strong random secret), and ensure service-role environment key is available to functions. Do not put service role keys or Firebase private keys in client config.
4. Apply `fcm_device_and_queue_migration.sql` only after backup and SQL preflight. It depends on the existing `admin_notifications` table/columns.
5. Deploy `register-push-device` and `deliver-crm-push` Edge Functions. Confirm `register-push-device` uses JWT verification and dispatcher `verify_jwt=false` plus `x-cron-secret`.
6. Configure a non-overlapping scheduled POST to `/functions/v1/deliver-crm-push` every 1–2 minutes with `x-cron-secret`. Use Supabase Cron/pg_net or an external scheduler; schedule is not installed by this source patch.
7. Rebuild/install Android APK after `google-services.json` is available in the build environment.

### FCM test checklist
- [ ] Firebase project and Android package ID match.
- [ ] `google-services.json` included only in controlled build environment.
- [ ] Push permission granted; Android notification channel `crm-push` created.
- [ ] Register token; verify row exists for authenticated user (never copy token into logs/screenshots).
- [ ] Logout revokes token; login re-registers.
- [ ] Insert a test admin notification and confirm job is enqueued.
- [ ] Dispatcher returns processed/sent counts; no service-account data in logs.
- [ ] Physical phone receives notification with CRM app backgrounded and force-closed.
- [ ] Tap notification opens/foregrounds app; record actual navigation behavior.
- [ ] Token refresh, reinstall, invalid token cleanup, retry and duplicate-send behavior tested.
- [ ] Test multiple devices for one account and disable/revoke device independently.

### Implementation limitations / review items
- Push event source currently mirrors `admin_notifications` inserts only; it is not a generalized CRM event fanout. Existing admin notification trigger sources currently include selected staff/signup/new-lead events.
- The push client forwards notification events to `sr-push-received` and `sr-push-action`; app deep-link/navigation handling still needs product-specific implementation and verification.
- Delivery queue currently attempts sends to all active devices for the recipient; successful delivery to any device marks the job sent. Provider acceptance is not proof of on-device display.
- Dispatcher uses scheduled invocation, which must be configured outside the repository source.
- SQL/function source and GitHub CI do not prove production migration/deploy, Firebase credentials, or physical device receipt.
