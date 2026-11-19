-- S.R. Developers CRM FCM scheduler setup (run manually in Supabase SQL Editor)
-- PRECONDITION: set Edge Function secrets FCMS_SERVICE_ACCOUNT_JSON, PUSH_DISPATCH_SECRET.
-- Keep the same long random PUSH_DISPATCH_SECRET in Edge Function secrets and Vault below.
-- Create these Vault entries once; never paste the Firebase service-account JSON into SQL:
-- select vault.create_secret('https://amzqgvyslzvhcilawunc.supabase.co','crm_project_url');
-- select vault.create_secret('<YOUR_PUSH_DISPATCH_SECRET>','crm_push_dispatch_secret');
--
-- This script creates/updates only one 5-minute cron job. It does not touch CRM records.
-- Supabase Vault is referenced at runtime; the cron command does not embed the dispatch secret.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $setup$
declare
  url_present boolean;
  secret_present boolean;
begin
  select exists(select 1 from vault.decrypted_secrets where name='crm_project_url') into url_present;
  select exists(select 1 from vault.decrypted_secrets where name='crm_push_dispatch_secret') into secret_present;
  if not url_present or not secret_present then
    raise exception 'Missing Vault entries: crm_project_url and crm_push_dispatch_secret. Create both entries first; secret values are never displayed by this script.';
  end if;
end
$setup$;

select cron.schedule(
  'deliver-crm-push',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='crm_project_url')
             || '/functions/v1/deliver-crm-push',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='crm_push_dispatch_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 15000
    ) as request_id;
  $job$
);
