-- Sub-brands (ONIC ID, ONIC PH, …) as a list the Admin can add to, instead of a fixed list in the app.

create table public.sub_brands (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name = btrim(name) and length(name) between 1 and 60),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index sub_brands_name_key on public.sub_brands (lower(name));

insert into public.sub_brands (name, created_by) values ('ONIC ID', null), ('ONIC PH', null), ('ONIC Padel', null);

create trigger sub_brands_audit after insert or update or delete on public.sub_brands
  for each row execute function private.audit_library();

alter table public.sub_brands enable row level security;
create policy sub_brands_require_active_mfa on public.sub_brands as restrictive to authenticated
  using ((select private.is_active()) and (select private.mfa_satisfied()))
  with check ((select private.is_active()) and (select private.mfa_satisfied()));
create policy sub_brands_read on public.sub_brands for select to authenticated using (true);
create policy sub_brands_admin_insert on public.sub_brands for insert to authenticated with check ((select private.is_admin()));
create policy sub_brands_admin_update on public.sub_brands for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy sub_brands_admin_delete on public.sub_brands for delete to authenticated using ((select private.is_admin()));

grant select, delete on public.sub_brands to authenticated;
grant insert (name), update (name) on public.sub_brands to authenticated;
grant select, insert, update, delete on public.sub_brands to service_role;
