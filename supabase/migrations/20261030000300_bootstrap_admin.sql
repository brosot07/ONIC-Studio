-- One-time setup of the first Admin. Run from the Supabase SQL editor (which runs as the database
-- owner) after creating the user under Authentication → Users. Refuses to run once any Admin exists,
-- so it can never be used to take over a working installation.
create function private.bootstrap_admin(p_email text, p_full_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  if exists (select 1 from public.user_roles where role = 'admin') then
    raise exception 'An Admin already exists. Invite people from ONIC Studio → People instead.';
  end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then
    raise exception 'No user with that email. Create them first under Authentication → Users → Add user.';
  end if;
  insert into public.profiles (id, org_id, team_id, full_name, email)
  values (uid, '00000000-0000-4000-8000-000000000001', null, trim(p_full_name), lower(trim(p_email)))
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (uid, 'admin') on conflict do nothing;
  insert into public.audit_log (actor, action, target, details) values (null, 'admin.bootstrapped', uid::text, '{}'::jsonb);
  return uid;
end
$$;
revoke all on function private.bootstrap_admin(text, text) from public, anon, authenticated, service_role;
