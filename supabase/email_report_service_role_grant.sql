-- Allow the Edge Function's Supabase service-role client to read CRM rows
-- for the scheduled email summary. This grants SELECT only; it does not
-- change row-level security policies or permit writes.
grant usage on schema public to service_role;
grant select on table public.crm_records to service_role;
