-- Events: match days, tournaments, photoshoots… Each event holds its photos and videos, and each file can be
-- tagged with the players in it. Admins and Social designers add files; a file tagged with a player designers
-- may not use (inactive, no consent, rights expired) is hidden from designers like the player.

create type public.event_kind as enum ('match_day', 'tournament', 'photoshoot', 'behind_the_scenes', 'community', 'other');
create type public.event_media_kind as enum ('photo', 'video');

create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name = btrim(name) and length(name) between 1 and 120),
  kind public.event_kind not null default 'match_day',
  starts_on date not null default current_date,
  ends_on date check (ends_on is null or ends_on >= starts_on),
  sub_brand text check (sub_brand is null or length(sub_brand) between 1 and 60),
  opponent text check (opponent is null or length(opponent) between 1 and 80),
  location text check (location is null or length(location) between 1 and 120),
  notes text check (notes is null or length(notes) <= 2000),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index events_starts_on_idx on public.events (starts_on desc);

create table public.event_media (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  kind public.event_media_kind not null,
  name text not null check (length(name) between 1 and 160),
  path text not null unique,
  -- Small JPEG preview made by the server (photos only), so grids never load full camera files.
  thumb_path text unique,
  mime text not null,
  bytes bigint not null check (bytes > 0),
  width integer,
  height integer,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index event_media_event_idx on public.event_media (event_id, created_at);

create table public.event_media_players (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null references public.event_media (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (media_id, player_id)
);
create index event_media_players_player_idx on public.event_media_players (player_id);

-- Who may add events and their files: Admins (with two-step sign-in) and Social designers.
create function private.can_add_event_media() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin() or private.has_role('social_designer')
$$;

-- A file is usable by designers unless it shows a player they may not use.
create function private.media_usable(p_media uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.event_media_players t join public.players p on p.id = t.player_id
    where t.media_id = p_media and not private.player_usable(p.status, p.consent, p.rights_expires_on))
$$;

grant execute on function private.can_add_event_media() to authenticated, service_role;
grant execute on function private.media_usable(uuid) to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['events', 'event_media', 'event_media_players'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_library()', t || '_audit', t);
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I as restrictive to authenticated using ((select private.is_active()) and (select private.mfa_satisfied())) with check ((select private.is_active()) and (select private.mfa_satisfied()))',
      t || '_require_active_mfa', t);
  end loop;
end
$$;

-- Events: everyone reads; Admins and Social designers add; the creator or an Admin edits; only Admins delete.
create policy events_read on public.events for select to authenticated using (true);
create policy events_insert on public.events for insert to authenticated
  with check ((select private.can_add_event_media()) and created_by = (select auth.uid()));
create policy events_update on public.events for update to authenticated
  using ((select private.is_admin()) or (created_by = (select auth.uid()) and (select private.can_add_event_media())))
  with check ((select private.is_admin()) or (created_by = (select auth.uid()) and (select private.can_add_event_media())));
create policy events_delete on public.events for delete to authenticated using ((select private.is_admin()));

-- Files: rows are created only by the server after checking the file.
create policy event_media_read on public.event_media for select to authenticated
  using ((select private.is_admin()) or private.media_usable(id));
create policy event_media_update on public.event_media for update to authenticated
  using ((select private.is_admin()) or (created_by = (select auth.uid()) and (select private.can_add_event_media())))
  with check ((select private.is_admin()) or (created_by = (select auth.uid()) and (select private.can_add_event_media())));
create policy event_media_delete on public.event_media for delete to authenticated
  using ((select private.is_admin()) or (created_by = (select auth.uid()) and (select private.can_add_event_media())));

-- Player tags.
create policy event_media_players_read on public.event_media_players for select to authenticated
  using ((select private.is_admin()) or private.media_usable(media_id));
create policy event_media_players_insert on public.event_media_players for insert to authenticated
  with check ((select private.can_add_event_media()) and created_by = (select auth.uid()));
create policy event_media_players_delete on public.event_media_players for delete to authenticated
  using ((select private.can_add_event_media()));

grant select, delete on public.events, public.event_media, public.event_media_players to authenticated;
grant insert (name, kind, starts_on, ends_on, sub_brand, opponent, location, notes),
  update (name, kind, starts_on, ends_on, sub_brand, opponent, location, notes) on public.events to authenticated;
grant update (name) on public.event_media to authenticated;
grant insert (media_id, player_id) on public.event_media_players to authenticated;
grant select, insert, update, delete on public.events, public.event_media, public.event_media_players to service_role;

-- File storage: one private bucket; a file can be opened only while its row is visible to the person.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('events', 'events', false, 524288000, array['image/png', 'image/jpeg', 'video/mp4', 'video/quicktime'])
on conflict (id) do nothing;
create policy event_files_read on storage.objects for select to authenticated
  using (bucket_id = 'events' and exists (select 1 from public.event_media m where m.path = objects.name or m.thumb_path = objects.name));

-- Social designers may now stage files too (still only in their own folder). The server decides what each
-- person may do with a staged file: designers can only add it to an event.
drop policy staging_admin_insert on storage.objects;
drop policy staging_admin_read on storage.objects;
drop policy staging_admin_delete on storage.objects;
create policy staging_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'staging' and (select private.can_add_event_media()) and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy staging_read on storage.objects for select to authenticated
  using (bucket_id = 'staging' and (select private.can_add_event_media()) and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy staging_delete on storage.objects for delete to authenticated
  using (bucket_id = 'staging' and (select private.can_add_event_media()) and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Registering a checked event file (called only by the library-upload function).
create function public.event_add_media(p_actor uuid, p_row jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if not exists (
    select 1 from public.user_roles ur join public.profiles p on p.id = ur.user_id
    where ur.user_id = p_actor and not p.disabled and ur.role in ('admin', 'social_designer')
  ) then
    raise exception 'not allowed to add event files' using errcode = '42501';
  end if;
  perform set_config('onic.actor', p_actor::text, true);
  insert into public.event_media (event_id, kind, name, path, thumb_path, mime, bytes, width, height, created_by)
  values ((p_row->>'event_id')::uuid, (p_row->>'kind')::public.event_media_kind, p_row->>'name', p_row->>'path', p_row->>'thumb_path',
          p_row->>'mime', (p_row->>'bytes')::bigint, (p_row->>'width')::int, (p_row->>'height')::int, p_actor)
  returning id into new_id;
  return new_id;
end
$$;
revoke all on function public.event_add_media(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.event_add_media(uuid, jsonb) to service_role;

-- Removing files: whoever may delete the row may delete its stored file and preview first.
create policy event_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'events' and exists (
    select 1 from public.event_media m
    where (m.path = objects.name or m.thumb_path = objects.name)
      and ((select private.is_admin()) or (m.created_by = (select auth.uid()) and (select private.can_add_event_media())))));
