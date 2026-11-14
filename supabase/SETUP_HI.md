# Supabase setup — S.R. Developers CRM

1. Supabase Dashboard → SQL Editor → New query.
2. Run `schema.sql` completely.
3. Project Settings → Data API: copy Project URL.
4. API Keys: copy only the Publishable key (`sb_publishable_...`).
5. Put these two values in `supabase/config.js` and commit the change.
6. Authentication → Providers → Email: enable email/password.
7. Authentication → Users → Add user: create the first Admin login.
8. Copy that user's UUID. In SQL Editor run:
   `insert into public.profiles(id,full_name,role,is_active) values ('USER_UUID','S.R. Developers Admin','admin',true);`
9. Create each staff member as an Auth user, then insert a matching profile with role and manager/team_leader IDs.
10. Test each role using separate accounts before entering real customer data.

IMPORTANT: Never share or paste `sb_secret_` or `service_role` keys. Revoke the secret key accidentally exposed in chat and rotate it.


## Broker / Channel Partner Portal

1. पहले ऊपर दिए गए employee CRM setup के बाद SQL Editor में `partner_portal_migration.sql` चलाएँ।
2. यह `channel_partners`, partner-owned `partner_leads` और `partner_commissions` tables तथा RLS access rules बनाता है।
3. Broker accounts को Admin approval के बाद ही active करना है। Broker केवल अपनी Partner Leads और अपना Commission देख सकेगा; company/staff records नहीं।
4. Login ID + temporary password बनाने के लिए secure server-side provisioning endpoint (Supabase Edge Function) चाहिए। यह काम browser/app में `sb_secret_` या `service_role` key रखकर कभी न करें।
5. Supabase Project URL और Publishable key को `supabase/config.js` में डालना और app में Supabase Auth + Edge Function integration पूरा करना बाकी है। तब तक Broker login को production-ready न मानें।
