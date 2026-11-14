-- S.R. Developers CRM app sync storage.
-- Run after ONE_TIME_SETUP.sql. Stores app records individually with role-scoped RLS.
create table if not exists public.crm_records (
  id uuid primary key,
  record_type text not null check (record_type in ('lead','followup','visit','booking','attendance','call_log','inventory','payment','partner','partner_payout','message','resource')),
  payload jsonb not null,
  owner_id uuid references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);
create index if not exists crm_records_type_idx on public.crm_records(record_type);
create index if not exists crm_records_owner_idx on public.crm_records(owner_id);
alter table public.crm_records enable row level security;
drop policy if exists crm_records_read_scope on public.crm_records;
create policy crm_records_read_scope on public.crm_records for select to authenticated
using (
  public.is_admin()
  or created_by=auth.uid()
  or owner_id=auth.uid()
  or (public.is_manager() and exists(
    select 1 from public.profiles p
    where p.id=crm_records.owner_id and p.manager_id=auth.uid() and p.is_active=true
  ))
);
drop policy if exists crm_records_insert_scope on public.crm_records;
create policy crm_records_insert_scope on public.crm_records for insert to authenticated
with check (
  created_by=auth.uid()
  and (owner_id=auth.uid() or public.is_admin()
    or (public.is_manager() and exists(
      select 1 from public.profiles p
      where p.id=crm_records.owner_id and p.manager_id=auth.uid() and p.is_active=true
    )))
);
drop policy if exists crm_records_update_scope on public.crm_records;
create policy crm_records_update_scope on public.crm_records for update to authenticated
using (public.is_admin() or created_by=auth.uid() or owner_id=auth.uid()
  or (public.is_manager() and exists(select 1 from public.profiles p where p.id=crm_records.owner_id and p.manager_id=auth.uid() and p.is_active=true)))
with check (public.is_admin() or created_by=auth.uid() or owner_id=auth.uid()
  or (public.is_manager() and exists(select 1 from public.profiles p where p.id=crm_records.owner_id and p.manager_id=auth.uid() and p.is_active=true)));
drop policy if exists crm_records_delete_scope on public.crm_records;
create policy crm_records_delete_scope on public.crm_records for delete to authenticated
using (public.is_admin() or created_by=auth.uid());
grant select,insert,update,delete on public.crm_records to authenticated;
