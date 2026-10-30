-- ONIC Studio — Phase 1 core: organisation, teams, people, roles, audit log, settings, rate limits.
-- Deny by default: nothing in public is reachable until a grant AND an RLS policy allow it.

create extension if not exists pgcrypto with schema extensions;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

-- Helper functions live here; the schema is not exposed through the API.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create type public.app_role as enum ('admin', 'approver', 'social_designer', 'merch_designer');
create type public.team_slug as enum ('social', 'merch');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  slug public.team_slug not null,
  name text not null check (length(name) between 1 and 80),
  unique (org_id, slug)
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete restrict,
  -- Designers belong to exactly one team. Admins and the Approver work across teams (null).
  team_id uuid references public.teams (id) on delete restrict,
  full_name text not null check (length(full_name) between 1 and 120),
  email text not null check (length(email) between 3 and 320),
  disabled boolean not null default false,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));
create index profiles_team_idx on public.profiles (team_id);

create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  user_id uuid references public.profiles (id) on delete set null,
  roles public.app_role[] not null,
  team_id uuid references public.teams (id),
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

-- Append-only. Nobody (not even admins through the API) can change or delete a row.
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  action text not null check (length(action) between 1 and 80),
  target text,
  details jsonb not null default '{}'::jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);

create table public.settings (
  key text primary key check (key ~ '^[a-z0-9_.]{1,64}$'),
  value jsonb not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.rate_limits (
  user_id uuid not null,
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (user_id, bucket, window_start)
);

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER, fixed search_path, never exposed via the API)
-- ---------------------------------------------------------------------------

create function private.uid() returns uuid
language sql stable security definer set search_path = '' as $$
  select auth.uid()
$$;

/** True when the caller's token proves two-step sign-in. */
create function private.is_aal2() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

create function private.is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and not p.disabled)
$$;

create function private.has_role(r public.app_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid() and ur.role = r and not p.disabled
  )
$$;

/** Admin and Approver must have signed in with two-step verification for anything at all. */
create function private.mfa_satisfied() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_aal2() or not exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role in ('admin', 'approver')
  )
$$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role('admin') and private.is_aal2()
$$;

create function private.is_approver() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role('approver') and private.is_aal2()
$$;

create function private.my_team() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.team_id from public.profiles p where p.id = auth.uid() and not p.disabled
$$;

/** Admins and the Approver see every team; designers only their own. */
create function private.can_see_team(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin() or private.is_approver() or (t is not null and t = private.my_team())
$$;

grant execute on all functions in schema private to authenticated, service_role;

-- What the app needs right after password sign-in (before two-step verification), so it can
-- decide whether to ask for a code. Returns only the caller's own data.
create function public.my_access()
returns table (user_id uuid, full_name text, email text, team public.team_slug, roles public.app_role[], needs_mfa boolean, disabled boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.email, t.slug,
         coalesce(array_agg(ur.role order by ur.role) filter (where ur.role is not null), '{}'),
         bool_or(ur.role in ('admin', 'approver')) is true,
         p.disabled
  from public.profiles p
  left join public.teams t on t.id = p.team_id
  left join public.user_roles ur on ur.user_id = p.id
  where p.id = auth.uid()
  group by p.id, t.slug
$$;
revoke all on function public.my_access() from public, anon;
grant execute on function public.my_access() to authenticated;

/** The only way to write the audit log. */
create function private.audit(p_action text, p_target text default null, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor, action, target, details) values (auth.uid(), p_action, p_target, coalesce(p_details, '{}'::jsonb))
$$;
revoke all on function private.audit(text, text, jsonb) from public, anon, authenticated;
grant execute on function private.audit(text, text, jsonb) to service_role;

/** Server-side audit entry on behalf of a signed-in person (Edge Functions run as the service role). */
create function public.audit_event(p_actor uuid, p_action text, p_target text default null, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor, action, target, details) values (p_actor, p_action, p_target, coalesce(p_details, '{}'::jsonb))
$$;
revoke all on function public.audit_event(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.audit_event(uuid, text, text, jsonb) to service_role;

create function private.block_audit_changes() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_log is append-only';
end
$$;
create trigger audit_log_no_update before update or delete or truncate on public.audit_log
  for each statement execute function private.block_audit_changes();

/**
 * Per-user rate limit. Returns true when the call is allowed.
 * Used by Edge Functions (service role) on behalf of a signed-in user.
 */
create function public.rate_limit_hit(p_user uuid, p_bucket text, p_max integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n integer;
begin
  insert into public.rate_limits as r (user_id, bucket, window_start, hits)
  values (p_user, p_bucket, w, 1)
  on conflict (user_id, bucket, window_start) do update set hits = r.hits + 1
  returning hits into n;
  delete from public.rate_limits where window_start < now() - interval '1 day';
  return n <= p_max;
end
$$;
revoke all on function public.rate_limit_hit(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(uuid, text, integer, integer) to service_role;

/** Ends every session of a user (lost laptop, offboarding). Access tokens die within 5 minutes. */
create function public.revoke_user_sessions(p_user uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from auth.sessions where user_id = p_user;
  get diagnostics n = row_count;
  return n;
end
$$;
revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end
$$;
create trigger profiles_touch before update on public.profiles for each row execute function private.touch_updated_at();

-- Audit every role and profile change, whoever makes it.
create function private.audit_roles() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit('role.granted', new.user_id::text, jsonb_build_object('role', new.role));
  elsif tg_op = 'DELETE' then
    perform private.audit('role.revoked', old.user_id::text, jsonb_build_object('role', old.role));
  end if;
  return null;
end
$$;
create trigger user_roles_audit after insert or delete on public.user_roles for each row execute function private.audit_roles();

create function private.audit_profiles() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit('user.created', new.id::text, jsonb_build_object('team_id', new.team_id));
  elsif new.disabled is distinct from old.disabled then
    perform private.audit(case when new.disabled then 'user.disabled' else 'user.enabled' end, new.id::text);
  elsif new.team_id is distinct from old.team_id then
    perform private.audit('user.team_changed', new.id::text, jsonb_build_object('from', old.team_id, 'to', new.team_id));
  end if;
  return null;
end
$$;
create trigger profiles_audit after insert or update on public.profiles for each row execute function private.audit_profiles();

-- Logins (and token refreshes are NOT logged; only new sessions).
create function private.audit_sign_in() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (actor, action, target, details)
  values (new.user_id, 'auth.sign_in', new.user_id::text,
          jsonb_build_object('aal', new.aal, 'user_agent', left(coalesce(new.user_agent, ''), 200), 'ip', host(new.ip)));
  update public.profiles set last_sign_in_at = now() where id = new.user_id;
  return null;
end
$$;
create trigger sessions_audit after insert on auth.sessions for each row execute function private.audit_sign_in();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_log enable row level security;
alter table public.settings enable row level security;
alter table public.rate_limits enable row level security;

-- Every table: active account + two-step sign-in for Admin/Approver. RESTRICTIVE, so it is ANDed
-- with every permissive policy below.
do $$
declare t text;
begin
  foreach t in array array['organizations','teams','profiles','user_roles','invitations','audit_log','settings','rate_limits'] loop
    execute format(
      'create policy %I on public.%I as restrictive to authenticated using ((select private.is_active()) and (select private.mfa_satisfied())) with check ((select private.is_active()) and (select private.mfa_satisfied()))',
      t || '_require_active_mfa', t);
  end loop;
end
$$;

create policy organizations_read on public.organizations for select to authenticated using (true);
create policy teams_read on public.teams for select to authenticated using (true);

create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()) or (select private.is_approver()) or (team_id is not null and team_id = (select private.my_team())));

create policy user_roles_read on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

create policy invitations_read on public.invitations for select to authenticated using ((select private.is_admin()));
create policy audit_log_read on public.audit_log for select to authenticated using ((select private.is_admin()));
create policy settings_write on public.settings for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
-- rate_limits: no policy for authenticated → no access.

grant select on public.organizations, public.teams, public.profiles, public.user_roles, public.invitations, public.audit_log to authenticated;
grant select, insert, update, delete on public.settings to authenticated;

-- ---------------------------------------------------------------------------
-- Seed: the one organisation and its two teams
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name) values ('00000000-0000-4000-8000-000000000001', 'ONIC Esports');
insert into public.teams (org_id, slug, name) values
  ('00000000-0000-4000-8000-000000000001', 'social', 'Social Media'),
  ('00000000-0000-4000-8000-000000000001', 'merch', 'Merchandise');

-- The server (Edge Functions, service role) manages people and roles; it still can't edit the audit log.
grant select, insert, update, delete on public.organizations, public.teams, public.profiles, public.user_roles,
  public.invitations, public.settings, public.rate_limits to service_role;
grant select, insert on public.audit_log to service_role;
