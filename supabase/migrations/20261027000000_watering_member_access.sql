-- Let anyone on the watering admin / worker / FC lists use the watering tables
-- again, on top of the existing staff + salesweb-admin access.
-- Applied to production on 27 Oct 2026, after a shared-database security
-- tightening (_mjm_ops_staff) locked operators out of the watering app.

create or replace function public._watering_member()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from public.watering_admins
                  where lower(btrim(email)) = lower(btrim(auth.jwt() ->> 'email')))
      or exists (select 1 from public.watering_workers
                  where lower(btrim(email)) = lower(btrim(auth.jwt() ->> 'email')))
      or exists (select 1 from public.watering_field_coordinators
                  where lower(btrim(email)) = lower(btrim(auth.jwt() ->> 'email')));
$function$;

revoke all on function public._watering_member() from public, anon;
grant execute on function public._watering_member() to authenticated;

do $$
declare
  r    record;
  cond text := '((select (public._mjm_ops_staff() or public._watering_member())))';
begin
  for r in
    select policyname, tablename, cmd
      from pg_policies
     where schemaname = 'public'
       and tablename like 'watering\_%'
       and (coalesce(qual, '') || coalesce(with_check, '')) like '%_mjm_ops_staff%'
  loop
    if r.cmd in ('SELECT', 'DELETE') then
      execute format('alter policy %I on public.%I using %s', r.policyname, r.tablename, cond);
    elsif r.cmd = 'INSERT' then
      execute format('alter policy %I on public.%I with check %s', r.policyname, r.tablename, cond);
    elsif r.cmd = 'UPDATE' then
      execute format('alter policy %I on public.%I using %s with check %s', r.policyname, r.tablename, cond, cond);
    end if;
  end loop;
end $$;
