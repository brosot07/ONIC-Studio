-- Supabase advisor 0029: no SECURITY DEFINER function in the exposed `public` schema should be callable by
-- signed-in users. The privileged bodies move to `private` (not reachable through the API); `public` keeps
-- thin SECURITY INVOKER wrappers with the same names, so the app and the server call them exactly as before.

alter function public.my_access() set schema private;
alter function public.transition_job(uuid, public.job_state, text) set schema private;

grant execute on function private.my_access() to authenticated;
grant execute on function private.transition_job(uuid, public.job_state, text) to authenticated, service_role;

create function public.my_access()
returns table (user_id uuid, full_name text, email text, team public.team_slug, roles public.app_role[], needs_mfa boolean, disabled boolean)
language sql stable security invoker set search_path = '' as $$
  select * from private.my_access()
$$;
revoke all on function public.my_access() from public, anon;
grant execute on function public.my_access() to authenticated;

create function public.transition_job(p_job uuid, p_to public.job_state, p_note text default null)
returns public.job_state
language sql security invoker set search_path = '' as $$
  select private.transition_job(p_job, p_to, p_note)
$$;
revoke all on function public.transition_job(uuid, public.job_state, text) from public, anon;
grant execute on function public.transition_job(uuid, public.job_state, text) to authenticated, service_role;
