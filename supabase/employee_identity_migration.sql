-- S.R. DEVELOPERS CRM: permanent sequential employee codes.
-- Safe additive migration: does not delete, rewrite, or deactivate existing profiles.
-- Existing trial profiles remain unchanged (employee_code stays NULL).
begin;

create sequence if not exists public.employee_code_seq
  as bigint
  start with 1
  increment by 1
  minvalue 1
  no cycle;

alter table public.profiles
  add column if not exists employee_code text;

create unique index if not exists profiles_employee_code_unique
  on public.profiles(employee_code)
  where employee_code is not null;

create or replace function public.assign_employee_code()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.employee_code is null or btrim(new.employee_code) = '' then
    new.employee_code := 'SRD' || lpad(nextval('public.employee_code_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_assign_employee_code on public.profiles;
create trigger profiles_assign_employee_code
before insert on public.profiles
for each row execute function public.assign_employee_code();

revoke all on function public.assign_employee_code() from public, anon, authenticated;
grant usage, select on sequence public.employee_code_seq to service_role;

commit;

-- Verification:
-- select employee_code, full_name, role from public.profiles order by employee_code nulls first;
