# Supabase setup — S.R. Developers CRM

## Database setup

**Fresh Supabase project:** सबसे आसान तरीका है कि SQL Editor में [ONE_TIME_SETUP.sql](./ONE_TIME_SETUP.sql) खोलकर पूरा script एक बार Run करें। इसमें base CRM schema, Admin/Manager/Executive access rules और Broker/Channel Partner portal tables शामिल हैं।

**अगर आपने पहले से कोई पुरानी SQL file चला रखी है:** ONE_TIME_SETUP.sql को दोबारा blindly न चलाएँ। पहले बताइए कौन-सी files execute हुई हैं; उसी हिसाब से safe upgrade sequence देंगे।

## Project configuration

1. Supabase Dashboard → Project Settings → Data API से Project URL लें।
2. API Keys से केवल Publishable key (`sb_publishable_...`) लें।
3. ये दोनों values `supabase/config.js` में configure करें।
4. Authentication → Providers → Email में email/password enable करें।
5. Authentication → Users में पहला Admin user बनाएँ।
6. उस user की UUID लेकर SQL Editor में चलाएँ:
   `insert into public.profiles(id,full_name,role,is_active) values ('USER_UUID','S.R. Developers Admin','admin',true);`
7. हर कर्मचारी को Auth user बनाकर matching profile दें; role और manager_id सही सेट करें।
8. Admin, Manager और Executive accounts से अलग-अलग login करके permissions जाँचें। असली ग्राहक डेटा तभी डालें जब tests सफल हों।

## Broker / Channel Partner Portal

- Partner accounts Admin approval से activate होंगे; open self-registration नहीं है।
- Broker केवल अपनी Partner Leads और अपनी Commission देख सकेगा; दूसरे brokers या company-wide staff records नहीं।
- Secure login provisioning के लिए `supabase/functions/create-partner-login` Edge Function deploy करनी होगी और server-side secrets Supabase Function Secrets में रखने होंगे।
- कभी भी `sb_secret_` या `service_role` key को app या `config.js` में न रखें। यदि ऐसी secret key पहले साझा हुई थी, Supabase Dashboard में उसे revoke/rotate करें।

## Current limitation

App में Project URL और Publishable key configure हैं, लेकिन database script चलाना, Auth users बनाना और Edge Function deploy करना अभी बाकी है। जब तक ये steps पूरे और test न हों, multi-device shared CRM और broker login को live/production-ready न मानें।


## App Cloud Sync (required for multiple phones)

After the database setup and Admin profile are created, run `app_cloud_sync_migration.sql` in Supabase SQL Editor. This creates the role-scoped `crm_records` table used by the app to sync CRM modules between signed-in devices. The app will load records allowed by the signed-in user's RLS role and upload that device's existing local records on first sync. Do not use real customer data until the migration has run and a second test account/device has been verified. Current first sync is additive; deleting a local record does not yet propagate a cloud delete.


## Staff ID creation: Admin-created + Self-signup request

1. Run `staff_signup_migration.sql` once in Supabase SQL Editor.
2. Deploy Edge Function `create-staff-login` from `supabase/functions/create-staff-login/index.ts`.
3. In Supabase → Edge Functions → Secrets, configure `SUPABASE_SERVICE_ROLE_KEY` using the project's service-role secret. Keep it server-side only; never put it in app config or share it in chat. The platform supplies the project URL and anon key to deployed functions in the standard environment.
4. Admin logs in → Team → Staff Login ID Management. Admin can create a staff login directly or approve a pending self-signup request. A temporary password is generated and shown once.
5. Staff can use the login screen's “नई ID के लिए Request भेजें” form. This only creates a pending request; it does not grant app access or allow self-assigned Admin roles. Admin approval creates the actual login and profile.
6. Give the temporary password to the employee privately. Ask them to change it after first login. Do not send passwords in group chats.

Roles available to staff signup: Manager, Team Leader, Sales Executive. Admin role is never self-selectable.


## Final hardening and reporting hierarchy

Run `final_hardening_migration.sql` once in SQL Editor after the three migrations above. It:
- Adds the reporting tree support for Manager → Team Leader → Sales Executive.
- Updates profile and cloud-record visibility to include a user's reporting tree.
- Adds a database unique index to prevent duplicate active project + plot/unit bookings.

If the unique index reports duplicate data, do not delete records blindly. Identify and resolve the duplicate active bookings first, then rerun this migration.

After updating `supabase/functions/create-staff-login/index.ts` in GitHub, redeploy the `create-staff-login` Edge Function from Supabase → Edge Functions → create-staff-login → Code → Deploy updates. The GitHub edit alone does not deploy the function to Supabase.

## Remaining production checks

- Password reset requires the GitHub Pages URL in Authentication → URL Configuration → Site URL and Redirect URLs.
- Background reminders require testing on the installed Android app with notification permission enabled; browser timers cannot guarantee delivery after the browser closes.
- A Play Store / production-signed APK requires a private Android signing keystore and passwords owned by the company. Do not share those secrets in chat. The current GitHub workflow builds a debug APK only.


## Employee Identity + Employee ID / Mobile Login rollout (SRD sequence)

This is an additive upgrade. It does not delete existing profiles, Auth users, CRM records, attendance, leads, bookings, or payments. Existing trial profiles are deliberately left with a NULL employee_code so the first approved real employee starts at SRD0001.

1. Take a Supabase database backup before the migration.
2. Run `employee_identity_migration.sql` once in Supabase SQL Editor. It adds a unique, sequential employee_code such as SRD0001 to newly created profiles.
3. Redeploy the updated `create-staff-login` Edge Function. It generates a six-digit numeric temporary password, stores the employee's registered mobile number, and returns the generated employeeCode.
4. Deploy `login-with-employee-code`. The supplied `supabase/config.toml` sets `verify_jwt = false` for this public login endpoint; deploy using the Supabase CLI linked to this project so that setting is applied. The endpoint accepts either an active SRD employee code or the registered mobile number and delegates password verification to Supabase Auth.
5. No SMS provider, OTP, or WhatsApp gateway is required for login. Admin can privately share the Employee ID and temporary six-digit password with the employee. Do not share credentials in group chats.
6. Employee login UI supports SRD Employee ID + six-digit password, Registered Mobile Number + password, and the existing Email + Password option.
7. Existing staff accounts with a mobile number saved in `profiles.phone` can use mobile login. Confirm the saved number is in the same Indian number format (+91 followed by 10 digits); duplicate phone numbers should be corrected before relying on mobile login.
8. Test with one newly created test employee first: verify SRD code assignment, Employee ID login, mobile login, active-profile checks, and role-scoped access. Do not deactivate trial accounts until the backup and inventory are reviewed.

Important: GitHub commits do not deploy Supabase Edge Functions or execute SQL migrations. Those deployment and dashboard steps must be completed separately.
