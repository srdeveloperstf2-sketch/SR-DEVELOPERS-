-- S.R. Developers CRM production preflight (READ-ONLY)
-- Run in Supabase SQL Editor. This report does not change business records or policies.
drop table if exists pg_temp.srcrm_preflight_report;
create temporary table srcrm_preflight_report (
  check_name text not null,
  status text not null,
  detail text not null
);

do $preflight$
declare
  tbl text;
  rls_enabled boolean;
  cols text[];
  missing text[];
  cron_count integer := -1;
  duplicate_booking_count integer := -1;
  active_tokens integer := -1;
  pending_push_jobs integer := -1;
  failed_push_jobs integer := -1;
  trigger_exists boolean := false;
  fn_exists boolean;
begin
  foreach tbl in array array['profiles','crm_records','admin_notifications','push_device_tokens','crm_push_jobs'] loop
    if to_regclass('public.'||tbl) is null then
      insert into srcrm_preflight_report values ('Table public.'||tbl,'FAIL','Table missing');
    else
      select c.relrowsecurity into rls_enabled from pg_class c where c.oid=to_regclass('public.'||tbl);
      insert into srcrm_preflight_report values ('Table public.'||tbl,'PASS','Exists; RLS='||coalesce(rls_enabled::text,'unknown'));
      if not coalesce(rls_enabled,false) then
        insert into srcrm_preflight_report values ('RLS public.'||tbl,'FAIL','Row Level Security is disabled');
      else
        insert into srcrm_preflight_report values ('RLS public.'||tbl,'PASS','Row Level Security enabled');
      end if;
    end if;
  end loop;

  if to_regclass('public.profiles') is not null then
    select array_agg(column_name order by column_name) into cols from information_schema.columns
      where table_schema='public' and table_name='profiles';
    missing:=array(select unnest(array['id','role','is_active','manager_id','team_leader_id']) except select unnest(coalesce(cols,array[]::text[])));
    insert into srcrm_preflight_report values ('Profile columns',case when coalesce(array_length(missing,1),0)=0 then 'PASS' else 'FAIL' end,
      case when coalesce(array_length(missing,1),0)=0 then 'Required role/reporting columns present' else 'Missing: '||array_to_string(missing,', ') end);
  end if;

  if to_regclass('public.crm_records') is not null then
    select array_agg(column_name order by column_name) into cols from information_schema.columns
      where table_schema='public' and table_name='crm_records';
    missing:=array(select unnest(array['id','record_type','payload','owner_id','created_by','updated_at']) except select unnest(coalesce(cols,array[]::text[])));
    insert into srcrm_preflight_report values ('CRM cloud columns',case when coalesce(array_length(missing,1),0)=0 then 'PASS' else 'FAIL' end,
      case when coalesce(array_length(missing,1),0)=0 then 'Required sync columns present' else 'Missing: '||array_to_string(missing,', ') end);
    execute $q$select count(*) from (
      select lower(payload->>'project'),lower(payload->>'unit') from public.crm_records
      where record_type='booking'
      and coalesce(lower(payload->>'status'),'') not in ('cancelled','rejected','lost')
      group by lower(payload->>'project'),lower(payload->>'unit') having count(*)>1
    ) duplicate_groups$q$ into duplicate_booking_count;
    insert into srcrm_preflight_report values ('Duplicate active plot/unit bookings',
      case when duplicate_booking_count=0 then 'PASS' else 'WARN' end,
      'Duplicate groups found: '||duplicate_booking_count::text);
  end if;

  if to_regclass('public.admin_notifications') is not null then
    select exists(select 1 from pg_trigger where tgrelid=to_regclass('public.admin_notifications') and not tgisinternal and tgname='trg_admin_notifications_enqueue_push') into trigger_exists;
    insert into srcrm_preflight_report values ('Push queue notification trigger',case when trigger_exists then 'PASS' else 'FAIL' end,
      case when trigger_exists then 'Trigger exists' else 'Trigger missing; new admin notifications will not enqueue pushes' end);
  end if;

  if to_regclass('public.push_device_tokens') is not null then
    execute 'select count(*) from public.push_device_tokens where revoked_at is null' into active_tokens;
    insert into srcrm_preflight_report values ('Active push device tokens','INFO','Count: '||active_tokens::text||' (token values intentionally not displayed)');
  end if;
  if to_regclass('public.crm_push_jobs') is not null then
    execute 'select count(*) from public.crm_push_jobs where status in (''pending'',''processing'')' into pending_push_jobs;
    execute 'select count(*) from public.crm_push_jobs where status=''failed''' into failed_push_jobs;
    insert into srcrm_preflight_report values ('Push queue backlog','INFO','Pending/processing: '||pending_push_jobs||'; failed: '||failed_push_jobs);
  end if;

  if to_regclass('cron.job') is not null then
    execute 'select count(*) from cron.job where jobname=''deliver-crm-push''' into cron_count;
    insert into srcrm_preflight_report values ('FCM cron schedule',case when cron_count>0 then 'PASS' else 'FAIL' end,
      'deliver-crm-push schedule count: '||cron_count::text);
  else
    insert into srcrm_preflight_report values ('FCM cron schedule','FAIL','pg_cron cron.job is not available; scheduled delivery cannot be verified');
  end if;

  foreach tbl in array array['is_admin','is_in_my_team','can_access_lead'] loop
    select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=tbl) into fn_exists;
    insert into srcrm_preflight_report values ('Security helper public.'||tbl,case when fn_exists then 'PASS' else 'FAIL' end,
      case when fn_exists then 'Function exists' else 'Function missing' end);
  end loop;
end
$preflight$;

select check_name,status,detail from srcrm_preflight_report order by
  case status when 'FAIL' then 1 when 'WARN' then 2 when 'INFO' then 3 else 4 end,
  check_name;
