-- Libraries: Admin edits, designers only read, and expired or ended entries are invisible to designers.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

delete from public.user_roles;

insert into auth.users (id, email, aud, role) values
  ('a1000000-0000-4000-8000-0000000000a1', 'lib-admin@onic.test', 'authenticated', 'authenticated'),
  ('c1000000-0000-4000-8000-0000000000c1', 'lib-social@onic.test', 'authenticated', 'authenticated');
insert into public.profiles (id, org_id, team_id, full_name, email) values
  ('a1000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', null, 'Lib Admin', 'lib-admin@onic.test'),
  ('c1000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000001', (select id from public.teams where slug = 'social'), 'Lib Social', 'lib-social@onic.test');
insert into public.user_roles (user_id, role) values
  ('a1000000-0000-4000-8000-0000000000a1', 'admin'),
  ('c1000000-0000-4000-8000-0000000000c1', 'social_designer');

insert into public.players (id, name, ign, status, consent, rights_expires_on) values
  ('11000000-0000-4000-8000-000000000001', 'Usable', 'OK', 'active', true, current_date + 30),
  ('11000000-0000-4000-8000-000000000002', 'Expired rights', 'EXP', 'active', true, current_date - 1),
  ('11000000-0000-4000-8000-000000000003', 'Inactive', 'OUT', 'inactive', true, null),
  ('11000000-0000-4000-8000-000000000004', 'No consent', 'NOC', 'active', false, null);
insert into public.player_assets (player_id, kind, name, path, mime, bytes, has_alpha) values
  ('11000000-0000-4000-8000-000000000001', 'cutout', 'ok', 'p/ok.png', 'image/png', 10, true),
  ('11000000-0000-4000-8000-000000000002', 'cutout', 'exp', 'p/exp.png', 'image/png', 10, true);
insert into storage.objects (bucket_id, name) values ('players', 'p/ok.png'), ('players', 'p/exp.png');

insert into public.sponsors (id, name, contract_start, contract_end) values
  ('22000000-0000-4000-8000-000000000001', 'Running', current_date - 10, current_date + 10),
  ('22000000-0000-4000-8000-000000000002', 'Ended', current_date - 100, current_date - 1),
  ('22000000-0000-4000-8000-000000000003', 'Not started', current_date + 5, current_date + 100);
insert into public.brand_assets (kind, name, path, mime, bytes) values ('logo', 'ONIC primary', 'b/logo.svg', 'image/svg+xml', 10);

create function pg_temp.act_as(uid uuid, aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
  execute 'set local role authenticated';
end $$;

-- Designer ------------------------------------------------------------------
select pg_temp.act_as('c1000000-0000-4000-8000-0000000000c1');
select results_eq($$select ign from public.players where id::text like '11000000%'$$, $$values ('OK')$$,
  'designers only see players with consent, active status and valid image rights');
select results_eq($$select count(*)::int from public.player_assets where path like 'p/%'$$, $$values (1)$$,
  'photos of hidden players are hidden too');
select results_eq($$select name from public.sponsors where id::text like '22000000%'$$, $$values ('Running')$$,
  'designers only see sponsors with a running contract');
select results_eq($$select count(*)::int from storage.objects where bucket_id = 'players' and name like 'p/%'$$, $$values (1)$$,
  'the file of a player with expired rights cannot be opened');
select isnt_empty($$select 1 from public.brand_assets$$, 'designers can see the Brand library');
select throws_ok($$insert into public.players (name, ign) values ('x', 'x')$$, '42501', null, 'designers cannot add players');
select throws_ok($$insert into public.sponsors (name) values ('x')$$, '42501', null, 'designers cannot add sponsors');
select throws_ok($$insert into public.brand_colors (name, hex) values ('x', '#FFFFFF')$$, '42501', null, 'designers cannot change the palette');
select throws_ok($$insert into public.brand_assets (kind, name, path, mime, bytes) values ('logo', 'x', 'b/x.svg', 'image/svg+xml', 1)$$,
  '42501', null, 'designers cannot add brand files');
update public.players set name = 'hacked' where id = '11000000-0000-4000-8000-000000000001';
delete from public.brand_assets;
select throws_ok($$insert into storage.objects (bucket_id, name) values ('players', 'p/direct.png')$$,
  '42501', null, 'designers cannot put files into a library');
reset role;
select is((select name from public.players where id = '11000000-0000-4000-8000-000000000001'), 'Usable',
  'a designer''s edit to a player changed nothing');
select is((select count(*)::int from public.brand_assets where path = 'b/logo.svg'), 1, 'a designer''s delete removed nothing');

-- Admin without two-step sign-in ------------------------------------------------
select pg_temp.act_as('a1000000-0000-4000-8000-0000000000a1', 'aal1');
select throws_ok($$insert into public.players (name, ign) values ('x', 'x')$$, '42501', null, 'Admin must use two-step sign-in to edit libraries');
reset role;

-- Admin with two-step sign-in ---------------------------------------------------
select pg_temp.act_as('a1000000-0000-4000-8000-0000000000a1', 'aal2');
select results_eq($$select count(*)::int from public.players where id::text like '11000000%'$$, $$values (4)$$, 'Admin sees every player');
select results_eq($$select count(*)::int from public.sponsors where id::text like '22000000%'$$, $$values (3)$$, 'Admin sees every sponsor');
select lives_ok($$insert into public.players (name, ign, consent) values ('New', 'NEW', true)$$, 'Admin adds a player');
select lives_ok($$insert into public.brand_colors (name, hex) values ('ONIC Yellow', '#FFD31A')$$, 'Admin adds a brand colour');
select throws_ok($$update public.brand_assets set path = 'b/other.svg'$$, '42501', null, 'not even Admin can repoint a library entry at another file');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('staging', (select auth.uid())::text || '/upload.png')$$,
  'Admin uploads into their own staging folder');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('staging', 'someone-else/upload.png')$$,
  '42501', null, 'Admin cannot upload into someone else''s staging folder');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('brand', 'b/direct.png')$$,
  '42501', null, 'files never go straight into a library; the server checks them first');
reset role;

-- Rules that hold even for the server ---------------------------------------------
select throws_ok($$insert into public.player_assets (player_id, kind, name, path, mime, bytes, has_alpha)
  values ('11000000-0000-4000-8000-000000000001', 'cutout', 'flat', 'p/flat.png', 'image/png', 10, false)$$,
  '23514', null, 'a cutout without a transparent background can never be stored');

set local role service_role;
select throws_ok($$select public.library_add_file('a1000000-0000-4000-8000-0000000000a1', 'players',
  '{"player_id":"11000000-0000-4000-8000-000000000002","kind":"cutout","name":"x","path":"p/x.png","mime":"image/png","bytes":1,"has_alpha":true}',
  (select lineage_id from public.player_assets where path = 'p/ok.png'))$$,
  '22023', null, 'a new version cannot retire another player''s photo');
select lives_ok($$select public.library_add_file('a1000000-0000-4000-8000-0000000000a1', 'players',
  '{"player_id":"11000000-0000-4000-8000-000000000001","kind":"cutout","name":"v2","path":"p/ok-v2.png","mime":"image/png","bytes":1,"has_alpha":true}',
  (select lineage_id from public.player_assets where path = 'p/ok.png'))$$, 'a new version of the same photo replaces the old one');
reset role;

select * from finish();
rollback;
