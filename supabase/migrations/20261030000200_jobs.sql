-- Jobs and their lifecycle. The state column can only change through transition_job(), which
-- enforces who may make each move. Mirrors packages/shared/src/jobs.ts.

create type public.job_state as enum (
  'DRAFT', 'RUNNING', 'NEEDS_DESIGNER', 'QC_PASSED', 'PENDING_APPROVAL', 'REJECTED',
  'APPROVED', 'SCHEDULED', 'PUBLISHED', 'PUBLISH_FAILED', 'FINAL'
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete restrict,
  type text not null check (type ~ '^[a-z_]{2,40}$'),
  title text not null check (length(title) between 1 and 200),
  state public.job_state not null default 'DRAFT',
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  budget_credits integer not null default 0 check (budget_credits >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_team_state_idx on public.jobs (team_id, state);

create table public.job_transitions (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs (id) on delete cascade,
  from_state public.job_state not null,
  to_state public.job_state not null,
  actor uuid,
  note text check (note is null or length(note) <= 2000),
  at timestamptz not null default now()
);
create index job_transitions_job_idx on public.job_transitions (job_id, at);

create function private.allowed_transition(f public.job_state, t public.job_state) returns boolean
language sql immutable set search_path = '' as $$
  select (f::text, t::text) in (
    ('DRAFT', 'RUNNING'),
    ('RUNNING', 'QC_PASSED'), ('RUNNING', 'NEEDS_DESIGNER'),
    ('NEEDS_DESIGNER', 'RUNNING'),
    ('QC_PASSED', 'PENDING_APPROVAL'), ('QC_PASSED', 'RUNNING'),
    ('PENDING_APPROVAL', 'APPROVED'), ('PENDING_APPROVAL', 'REJECTED'),
    ('REJECTED', 'RUNNING'),
    ('APPROVED', 'SCHEDULED'), ('APPROVED', 'FINAL'),
    ('SCHEDULED', 'PUBLISHED'), ('SCHEDULED', 'PUBLISH_FAILED'), ('SCHEDULED', 'APPROVED'),
    ('PUBLISH_FAILED', 'SCHEDULED')
  )
$$;

/**
 * The only way to move a job. Rules:
 *  - APPROVED / REJECTED: Approver with two-step sign-in, and only from PENDING_APPROVAL.
 *  - QC_PASSED / NEEDS_DESIGNER (QC results) and SCHEDULED / PUBLISHED / PUBLISH_FAILED: only the
 *    server (service role, where the agents and the publisher run), never a person.
 *  - FINAL (merch): Approver with two-step sign-in, from APPROVED.
 *  - Everything else: someone who can see the job's team.
 * A rejection must carry a plain-language note.
 */
create function public.transition_job(p_job uuid, p_to public.job_state, p_note text default null)
returns public.job_state
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs;
  is_server boolean := coalesce(auth.role(), '') = 'service_role';
begin
  select * into j from public.jobs where id = p_job for update;
  if not found then
    raise exception 'job not found' using errcode = 'P0002';
  end if;

  if not private.allowed_transition(j.state, p_to) then
    raise exception 'cannot move job from % to %', j.state, p_to using errcode = '42501';
  end if;

  if p_to in ('QC_PASSED', 'NEEDS_DESIGNER', 'SCHEDULED', 'PUBLISHED', 'PUBLISH_FAILED')
     or (j.state = 'SCHEDULED' and p_to = 'APPROVED') then
    if not is_server then
      raise exception 'only the ONIC Studio server can do this' using errcode = '42501';
    end if;
  elsif p_to in ('APPROVED', 'REJECTED', 'FINAL') then
    if not (private.is_approver() and private.is_active()) then
      raise exception 'only the Approver, signed in with two-step verification, can do this' using errcode = '42501';
    end if;
    if p_to = 'REJECTED' and coalesce(length(trim(p_note)), 0) = 0 then
      raise exception 'a rejection needs a note for the designer' using errcode = '22023';
    end if;
  elsif not is_server then
    if not (private.is_active() and private.mfa_satisfied() and private.can_see_team(j.team_id)) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  end if;

  perform set_config('onic.transition', 'on', true);
  update public.jobs set state = p_to, updated_at = now() where id = p_job;
  perform set_config('onic.transition', 'off', true);

  insert into public.job_transitions (job_id, from_state, to_state, actor, note)
  values (p_job, j.state, p_to, auth.uid(), nullif(trim(p_note), ''));

  if p_to in ('APPROVED', 'REJECTED', 'FINAL', 'PUBLISHED', 'PUBLISH_FAILED') then
    perform private.audit('job.' || lower(p_to::text), p_job::text, jsonb_build_object('from', j.state, 'note', nullif(trim(p_note), '')));
  end if;
  return p_to;
end
$$;
revoke all on function public.transition_job(uuid, public.job_state, text) from public, anon;
grant execute on function public.transition_job(uuid, public.job_state, text) to authenticated, service_role;

/** Blocks any state, team or owner change that doesn't come through transition_job(). */
create function private.guard_jobs() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.state <> 'DRAFT' then
      raise exception 'new jobs start as DRAFT' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.state is distinct from old.state and current_setting('onic.transition', true) is distinct from 'on' then
    raise exception 'job state can only change through transition_job()' using errcode = '42501';
  end if;
  if new.team_id is distinct from old.team_id or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'team, owner and creation time cannot change' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end
$$;
create trigger jobs_guard before insert or update on public.jobs for each row execute function private.guard_jobs();

create function private.block_transition_changes() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'job history is append-only';
end
$$;
create trigger job_transitions_no_update before update or delete or truncate on public.job_transitions
  for each statement execute function private.block_transition_changes();

alter table public.jobs enable row level security;
alter table public.job_transitions enable row level security;

create policy jobs_require_active_mfa on public.jobs as restrictive to authenticated
  using ((select private.is_active()) and (select private.mfa_satisfied())) with check ((select private.is_active()) and (select private.mfa_satisfied()));
create policy job_transitions_require_active_mfa on public.job_transitions as restrictive to authenticated
  using ((select private.is_active()) and (select private.mfa_satisfied()));

create policy jobs_read on public.jobs for select to authenticated using (private.can_see_team(team_id));
create policy jobs_create on public.jobs for insert to authenticated
  with check (team_id = (select private.my_team()) and created_by = (select auth.uid()));
create policy jobs_edit on public.jobs for update to authenticated
  using (team_id = (select private.my_team()) and state in ('DRAFT', 'NEEDS_DESIGNER', 'REJECTED'))
  with check (team_id = (select private.my_team()));

create policy job_transitions_read on public.job_transitions for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id and private.can_see_team(j.team_id)));

grant select, insert on public.jobs to authenticated;
grant update (title, budget_credits) on public.jobs to authenticated;
grant select on public.job_transitions to authenticated;

grant select, insert, update on public.jobs to service_role;
grant select, insert on public.job_transitions to service_role;
