-- FCM device registration and durable push queue (source migration; apply only after production preflight/backup).
begin;
create table if not exists public.push_device_tokens (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 token text not null unique,
 platform text not null check(platform in ('android','ios')),
 device_label text,
 last_seen_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 revoked_at timestamptz
);
create index if not exists push_device_tokens_user_active_idx on public.push_device_tokens(user_id) where revoked_at is null;
alter table public.push_device_tokens enable row level security;
drop policy if exists push_device_tokens_owner_select on public.push_device_tokens;
create policy push_device_tokens_owner_select on public.push_device_tokens for select to authenticated using (auth.uid()=user_id);
revoke all on public.push_device_tokens from anon, authenticated;
grant select on public.push_device_tokens to authenticated;

create table if not exists public.crm_push_jobs (
 id bigint generated always as identity primary key,
 recipient_id uuid not null references auth.users(id) on delete cascade,
 title text not null,
 body text not null,
 data jsonb not null default '{}'::jsonb,
 status text not null default 'pending' check(status in ('pending','processing','sent','failed')),
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 last_error text,
 created_at timestamptz not null default now(),
 sent_at timestamptz
);
create index if not exists crm_push_jobs_due_idx on public.crm_push_jobs(status,next_attempt_at) where status in ('pending','failed');
alter table public.crm_push_jobs enable row level security;
revoke all on public.crm_push_jobs from anon, authenticated;

create or replace function public.enqueue_admin_notification_push()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
 if new.recipient_id is not null then
  insert into public.crm_push_jobs(recipient_id,title,body,data)
  values(new.recipient_id,
   coalesce(nullif(new.title,''),'S.R. Developers CRM'),
   left(coalesce(new.customer_name,'CRM में नया अपडेट') || case when coalesce(new.customer_phone,'')<>'' then ' · '||new.customer_phone else '' || case when coalesce(new.project_name,'')<>'' then ' · '||new.project_name else '' end,500),
   jsonb_build_object('notification_id',new.id,'event_type',new.event_type));
 end if;
 return new;
end $$;
drop trigger if exists trg_admin_notifications_enqueue_push on public.admin_notifications;
create trigger trg_admin_notifications_enqueue_push after insert on public.admin_notifications
for each row execute function public.enqueue_admin_notification_push();
revoke all on function public.enqueue_admin_notification_push() from public,anon,authenticated;
commit;
