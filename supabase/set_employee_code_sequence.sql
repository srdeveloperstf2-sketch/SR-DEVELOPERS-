-- S.R. Developers: allow the privileged Edge Function to set the next employee code.
-- Does not delete or modify any CRM records.
create or replace function public.set_employee_code_sequence(p_next bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_next < 1 then
    raise exception 'p_next must be at least 1';
  end if;
  perform setval('public.employee_code_seq', p_next, false);
end;
$$;
revoke all on function public.set_employee_code_sequence(bigint) from public, anon, authenticated;
grant execute on function public.set_employee_code_sequence(bigint) to service_role;
