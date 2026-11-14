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
