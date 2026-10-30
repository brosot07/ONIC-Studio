-- Phase 2: the three asset libraries (Brand, Players, Sponsors), their files and usage log.
-- Admins (with two-step sign-in) edit; everyone else reads. Players whose image rights expired, who aren't
-- active or who withdrew consent, and sponsors whose contract ended, are invisible to designers.
-- Files are uploaded to a private staging bucket and moved into place only by the library-upload function
-- after it has checked them.

create type public.language_code as enum ('id', 'en', 'ph');
create type public.brand_asset_kind as enum ('logo', 'font', 'background', 'texture', 'template', 'guideline', 'other');
create type public.player_status as enum ('active', 'inactive', 'loaned');
create type public.player_asset_kind as enum ('cutout', 'headshot', 'action');
create type public.sponsor_asset_kind as enum ('logo_light', 'logo_dark', 'logo_mono', 'guideline');

-- Columns every stored file shares. `lineage_id` ties versions of the same asset together.
create table public.brand_assets (
  id uuid primary key default gen_random_uuid(),
  lineage_id uuid not null default gen_random_uuid(),
  version integer not null default 1 check (version >= 1),
  is_current boolean not null default true,
  kind public.brand_asset_kind not null,
  brand text not null default 'ONIC' check (length(brand) between 1 and 60),
  variant text check (variant is null or variant ~ '^[a-z_]{1,30}$'),
  name text not null check (length(name) between 1 and 160),
  tags text[] not null default '{}',
  path text not null unique,
  mime text not null,
  bytes integer not null check (bytes > 0),
  width integer,
  height integer,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index brand_assets_kind_idx on public.brand_assets (kind, brand) where is_current;

create table public.brand_colors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 60),
  hex text not null check (hex ~ '^#[0-9A-F]{6}$'),
  cmyk text check (cmyk is null or length(cmyk) <= 40),
  pantone text check (pantone is null or length(pantone) <= 40),
  usage text check (usage is null or length(usage) <= 300),
  sort integer not null default 0
);

create table public.voice_guides (
  id uuid primary key default gen_random_uuid(),
  account text not null check (account ~ '^[A-Za-z0-9._]{1,30}$'),
  language public.language_code not null,
  guide text not null default '' check (length(guide) <= 20000),
  sample_captions text[] not null default '{}',
  banned_words text[] not null default '{}',
  banned_topics text[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique (account, language)
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  ign text not null check (length(ign) between 1 and 60),
  role_lane text check (role_lane is null or length(role_lane) <= 60),
  team_name text check (team_name is null or length(team_name) <= 80),
  status public.player_status not null default 'active',
  rights_expires_on date,
  consent boolean not null default false,
  notes text check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index players_ign_team_key on public.players (lower(ign), coalesce(lower(team_name), ''));

create table public.player_assets (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete cascade,
  lineage_id uuid not null default gen_random_uuid(),
  version integer not null default 1 check (version >= 1),
  is_current boolean not null default true,
  kind public.player_asset_kind not null,
  name text not null check (length(name) between 1 and 160),
  tags text[] not null default '{}',
  path text not null unique,
  mime text not null,
  bytes integer not null check (bytes > 0),
  width integer,
  height integer,
  has_alpha boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (kind <> 'cutout' or has_alpha)
);
create index player_assets_player_idx on public.player_assets (player_id) where is_current;

create table public.sponsors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  tier text check (tier is null or length(tier) <= 40),
  instagram_handle text check (instagram_handle is null or instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'),
  instagram_user_id text check (instagram_user_id is null or instagram_user_id ~ '^[0-9]{1,30}$'),
  mandatory_tags text[] not null default '{}',
  hashtags text[] not null default '{}',
  mentions text[] not null default '{}',
  monthly_deliverables integer check (monthly_deliverables is null or monthly_deliverables >= 0),
  contract_start date,
  contract_end date,
  conflicts text[] not null default '{}',
  placement_rules text check (placement_rules is null or length(placement_rules) <= 4000),
  min_logo_px integer check (min_logo_px is null or min_logo_px between 1 and 4000),
  clear_space_ratio numeric check (clear_space_ratio is null or clear_space_ratio between 0 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (contract_end is null or contract_start is null or contract_end >= contract_start)
);
create unique index sponsors_name_key on public.sponsors (lower(name));

create table public.sponsor_assets (
  id uuid primary key default gen_random_uuid(),
  sponsor_id uuid not null references public.sponsors (id) on delete cascade,
  lineage_id uuid not null default gen_random_uuid(),
  version integer not null default 1 check (version >= 1),
  is_current boolean not null default true,
  kind public.sponsor_asset_kind not null,
  name text not null check (length(name) between 1 and 160),
  path text not null unique,
  mime text not null,
  bytes integer not null check (bytes > 0),
  width integer,
  height integer,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index sponsor_assets_sponsor_idx on public.sponsor_assets (sponsor_id) where is_current;

-- Which posts and designs used which asset (written by the server in later phases).
create table public.asset_usage (
  id bigint generated always as identity primary key,
  asset_table text not null check (asset_table in ('brand_assets', 'player_assets', 'sponsor_assets')),
  asset_id uuid not null,
  job_id uuid not null references public.jobs (id) on delete cascade,
  used_at timestamptz not null default now()
);
create index asset_usage_asset_idx on public.asset_usage (asset_table, asset_id);

create trigger players_touch before update on public.players for each row execute function private.touch_updated_at();
create trigger sponsors_touch before update on public.sponsors for each row execute function private.touch_updated_at();
create trigger voice_guides_touch before update on public.voice_guides for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Usability: what designers (and QC) may use today
-- ---------------------------------------------------------------------------

create function private.player_usable(p_status public.player_status, p_consent boolean, p_rights date)
returns boolean language sql stable set search_path = '' as $$
  select p_status = 'active' and p_consent and (p_rights is null or p_rights >= current_date)
$$;

create function private.sponsor_active(p_start date, p_end date)
returns boolean language sql stable set search_path = '' as $$
  select (p_start is null or p_start <= current_date) and (p_end is null or p_end >= current_date)
$$;

grant execute on function private.player_usable(public.player_status, boolean, date) to authenticated, service_role;
grant execute on function private.sponsor_active(date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Audit every library change
-- ---------------------------------------------------------------------------

create function private.audit_library() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target text := coalesce((case when tg_op = 'DELETE' then old.id else new.id end)::text, '');
begin
  perform private.audit('library.' || tg_table_name || '.' || lower(tg_op), target, '{}'::jsonb);
  return null;
end
$$;

do $$
declare t text;
begin
  foreach t in array array['brand_assets','brand_colors','voice_guides','players','player_assets','sponsors','sponsor_assets'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_library()', t || '_audit', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['brand_assets','brand_colors','voice_guides','players','player_assets','sponsors','sponsor_assets','asset_usage'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I as restrictive to authenticated using ((select private.is_active()) and (select private.mfa_satisfied())) with check ((select private.is_active()) and (select private.mfa_satisfied()))',
      t || '_require_active_mfa', t);
  end loop;
end
$$;

-- Brand library and voice guides: everyone reads, Admin writes.
create policy brand_assets_read on public.brand_assets for select to authenticated using (true);
create policy brand_colors_read on public.brand_colors for select to authenticated using (true);
create policy voice_guides_read on public.voice_guides for select to authenticated using (true);

-- Players: Admin sees everyone; others only players they may use today.
create policy players_read on public.players for select to authenticated
  using ((select private.is_admin()) or private.player_usable(status, consent, rights_expires_on));
create policy player_assets_read on public.player_assets for select to authenticated
  using ((select private.is_admin()) or exists (
    select 1 from public.players p where p.id = player_id and private.player_usable(p.status, p.consent, p.rights_expires_on)));

-- Sponsors: Admin sees all; others only sponsors with a running contract.
create policy sponsors_read on public.sponsors for select to authenticated
  using ((select private.is_admin()) or private.sponsor_active(contract_start, contract_end));
create policy sponsor_assets_read on public.sponsor_assets for select to authenticated
  using ((select private.is_admin()) or exists (
    select 1 from public.sponsors s where s.id = sponsor_id and private.sponsor_active(s.contract_start, s.contract_end)));

create policy asset_usage_read on public.asset_usage for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id and private.can_see_team(j.team_id)));

-- Admin writes (metadata). File rows themselves are created only by the server after checking the file.
do $$
declare t text;
begin
  foreach t in array array['brand_colors','voice_guides','players','sponsors'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.is_admin()))', t || '_admin_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))', t || '_admin_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.is_admin()))', t || '_admin_delete', t);
  end loop;
  foreach t in array array['brand_assets','player_assets','sponsor_assets'] loop
    execute format('create policy %I on public.%I for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))', t || '_admin_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.is_admin()))', t || '_admin_delete', t);
  end loop;
end
$$;

grant select on public.brand_assets, public.brand_colors, public.voice_guides, public.players, public.player_assets,
  public.sponsors, public.sponsor_assets, public.asset_usage to authenticated;
grant insert, update, delete on public.brand_colors, public.voice_guides, public.players, public.sponsors to authenticated;
-- Admins may rename, re-tag or retire a file entry, never repoint it at another file.
grant update (name, tags, is_current, variant, brand) on public.brand_assets to authenticated;
grant update (name, tags, is_current) on public.player_assets to authenticated;
grant update (name, is_current) on public.sponsor_assets to authenticated;
grant delete on public.brand_assets, public.player_assets, public.sponsor_assets to authenticated;

grant select, insert, update, delete on public.brand_assets, public.brand_colors, public.voice_guides, public.players,
  public.player_assets, public.sponsors, public.sponsor_assets to service_role;
grant select, insert on public.asset_usage to service_role;

-- ---------------------------------------------------------------------------
-- File storage: private buckets
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('staging', 'staging', false, 52428800, null),
  ('brand', 'brand', false, 52428800, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'font/otf', 'font/ttf', 'font/woff', 'font/woff2', 'application/pdf']),
  ('players', 'players', false, 52428800, array['image/png', 'image/jpeg', 'image/webp']),
  ('sponsors', 'sponsors', false, 52428800, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/pdf'])
on conflict (id) do nothing;

-- Admins upload into their own staging folder; the server checks the file and moves it into a library.
create policy staging_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'staging' and (select private.is_admin()) and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy staging_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'staging' and (select private.is_admin()) and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy staging_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'staging' and (select private.is_admin()) and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Library files: readable (through short-lived signed links) only when the matching row is visible.
create policy brand_files_read on storage.objects for select to authenticated
  using (bucket_id = 'brand' and (select private.is_active()) and (select private.mfa_satisfied())
         and exists (select 1 from public.brand_assets a where a.path = objects.name));
create policy player_files_read on storage.objects for select to authenticated
  using (bucket_id = 'players' and exists (select 1 from public.player_assets a where a.path = objects.name));
create policy sponsor_files_read on storage.objects for select to authenticated
  using (bucket_id = 'sponsors' and exists (select 1 from public.sponsor_assets a where a.path = objects.name));

-- ---------------------------------------------------------------------------
-- Registering a checked file (called only by the library-upload function).
-- A new version of an existing asset keeps its lineage and retires the previous version.
-- ---------------------------------------------------------------------------
create function public.library_add_file(p_actor uuid, p_library text, p_row jsonb, p_replaces uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  new_id uuid;
  lineage uuid := coalesce(p_replaces, gen_random_uuid());
  next_version integer := 1;
begin
  perform set_config('onic.actor', p_actor::text, true);
  if p_library = 'brand' then
    if p_replaces is not null then
      select coalesce(max(version), 0) + 1 into next_version from public.brand_assets where lineage_id = p_replaces;
      update public.brand_assets set is_current = false where lineage_id = p_replaces;
    end if;
    insert into public.brand_assets (lineage_id, version, kind, brand, variant, name, tags, path, mime, bytes, width, height, created_by)
    values (lineage, next_version, (p_row->>'kind')::public.brand_asset_kind, coalesce(p_row->>'brand', 'ONIC'), p_row->>'variant',
            p_row->>'name', coalesce(array(select jsonb_array_elements_text(p_row->'tags')), '{}'), p_row->>'path', p_row->>'mime',
            (p_row->>'bytes')::int, (p_row->>'width')::int, (p_row->>'height')::int, p_actor)
    returning id into new_id;
  elsif p_library = 'players' then
    if p_replaces is not null then
      select coalesce(max(version), 0) + 1 into next_version from public.player_assets where lineage_id = p_replaces;
      update public.player_assets set is_current = false where lineage_id = p_replaces;
    end if;
    insert into public.player_assets (player_id, lineage_id, version, kind, name, tags, path, mime, bytes, width, height, has_alpha, created_by)
    values ((p_row->>'player_id')::uuid, lineage, next_version, (p_row->>'kind')::public.player_asset_kind, p_row->>'name',
            coalesce(array(select jsonb_array_elements_text(p_row->'tags')), '{}'), p_row->>'path', p_row->>'mime',
            (p_row->>'bytes')::int, (p_row->>'width')::int, (p_row->>'height')::int, coalesce((p_row->>'has_alpha')::boolean, false), p_actor)
    returning id into new_id;
  elsif p_library = 'sponsors' then
    if p_replaces is not null then
      select coalesce(max(version), 0) + 1 into next_version from public.sponsor_assets where lineage_id = p_replaces;
      update public.sponsor_assets set is_current = false where lineage_id = p_replaces;
    end if;
    insert into public.sponsor_assets (sponsor_id, lineage_id, version, kind, name, path, mime, bytes, width, height, created_by)
    values ((p_row->>'sponsor_id')::uuid, lineage, next_version, (p_row->>'kind')::public.sponsor_asset_kind, p_row->>'name',
            p_row->>'path', p_row->>'mime', (p_row->>'bytes')::int, (p_row->>'width')::int, (p_row->>'height')::int, p_actor)
    returning id into new_id;
  else
    raise exception 'unknown library' using errcode = '22023';
  end if;
  return new_id;
end
$$;
revoke all on function public.library_add_file(uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.library_add_file(uuid, text, jsonb, uuid) to service_role;
