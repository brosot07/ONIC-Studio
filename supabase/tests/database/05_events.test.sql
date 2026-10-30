-- Events: Admins and Social designers add; merch designers only look; photos of a player designers may not use stay hidden.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

delete from public.user_roles;

insert into auth.users (id, email, aud, role) values
  ('a3000000-0000-4000-8000-0000000000a3', 'ev-admin@onic.test', 'authenticated', 'authenticated'),
  ('c3000000-0000-4000-8000-0000000000c3', 'ev-social@onic.test', 'authenticated', 'authenticated'),
  ('c3000000-0000-4000-8000-0000000000c4', 'ev-social2@onic.test', 'authenticated', 'authenticated'),
  ('d3000000-0000-4000-8000-0000000000d3', 'ev-merch@onic.test', 'authenticated', 'authenticated');
insert into public.profiles (id, org_id, team_id, full_name, email) values
  ('a3000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-000000000001', null, 'Ev Admin', 'ev-admin@onic.test'),
  ('c3000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-000000000001', (select id from public.teams where slug = 'social'), 'Ev Social', 'ev-social@onic.test'),
  ('c3000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-000000000001', (select id from public.teams where slug = 'social'), 'Ev Social 2', 'ev-social2@onic.test'),
  ('d3000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-000000000001', (select id from public.teams where slug = 'merch'), 'Ev Merch', 'ev-merch@onic.test');
insert into public.user_roles (user_id, role) values
  ('a3000000-0000-4000-8000-0000000000a3', 'admin'),
  ('c3000000-0000-4000-8000-0000000000c3', 'social_designer'),
  ('c3000000-0000-4000-8000-0000000000c4', 'social_designer'),
  ('d3000000-0000-4000-8000-0000000000d3', 'merch_designer');

insert into public.players (id, name, ign, status, consent, rights_expires_on) values
  ('13000000-0000-4000-8000-000000000001', 'Usable', 'OK', 'active', true, null),
  ('13000000-0000-4000-8000-000000000002', 'Expired', 'EXP', 'active', true, current_date - 1);
insert into public.events (id, name, kind, created_by) values
  ('e3000000-0000-4000-8000-000000000001', 'MPL W3 ONIC vs RRQ', 'match_day', 'c3000000-0000-4000-8000-0000000000c3');
insert into public.event_media (id, event_id, kind, name, path, mime, bytes, created_by) values
  ('f3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', 'photo', 'ok', 'e/ok.jpg', 'image/jpeg', 10, 'c3000000-0000-4000-8000-0000000000c3'),
  ('f3000000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-000000000001', 'photo', 'exp', 'e/exp.jpg', 'image/jpeg', 10, 'c3000000-0000-4000-8000-0000000000c3');
insert into public.event_media_players (media_id, player_id) values
  ('f3000000-0000-4000-8000-000000000002', '13000000-0000-4000-8000-000000000002');
insert into storage.objects (bucket_id, name) values ('events', 'e/ok.jpg'), ('events', 'e/exp.jpg');

create function pg_temp.act_as(uid uuid, aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
  execute 'set local role authenticated';
end $$;

-- Social designer --------------------------------------------------------------
select pg_temp.act_as('c3000000-0000-4000-8000-0000000000c3');
select lives_ok($$insert into public.events (name, kind) values ('Kopdar Jakarta', 'community')$$, 'a Social designer creates an event');
select results_eq($$select name from public.event_media where event_id = 'e3000000-0000-4000-8000-000000000001' order by name$$, $$values ('ok')$$,
  'a photo showing a player with expired rights is hidden from designers');
select results_eq($$select count(*)::int from storage.objects where bucket_id = 'events' and name in ('e/ok.jpg', 'e/exp.jpg')$$, $$values (1)$$,
  'and its file cannot be opened');
select lives_ok($$insert into public.event_media_players (media_id, player_id) values ('f3000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001')$$,
  'the uploader tags a player');
select throws_ok($$insert into public.event_media_players (media_id, player_id) values ('f3000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'designers cannot tag a player they may not use');
select throws_ok($$insert into public.event_media (event_id, kind, name, path, mime, bytes) values ('e3000000-0000-4000-8000-000000000001', 'photo', 'x', 'e/x.jpg', 'image/jpeg', 1)$$,
  '42501', null, 'files are only added by the server after checking them');
select lives_ok($$update public.events set name = 'MPL W3 · ONIC vs RRQ' where id = 'e3000000-0000-4000-8000-000000000001'$$, 'the creator renames their event');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('staging', (select auth.uid())::text || '/photo.jpg')$$,
  'a Social designer stages a file in their own folder');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('staging', 'a3000000-0000-4000-8000-0000000000a3/photo.jpg')$$,
  '42501', null, 'but not in someone else''s');
select throws_ok($$insert into public.events (name, created_by) values ('Forged', 'a3000000-0000-4000-8000-0000000000a3')$$,
  '42501', null, 'nobody can create an event in someone else''s name');
delete from public.events where id = 'e3000000-0000-4000-8000-000000000001';
reset role;
select is((select count(*)::int from public.events where id = 'e3000000-0000-4000-8000-000000000001'), 1, 'only Admins delete events');

-- Another Social designer can't edit someone else's event or its tags ------------
select pg_temp.act_as('c3000000-0000-4000-8000-0000000000c4');
update public.events set name = 'Hijacked' where id = 'e3000000-0000-4000-8000-000000000001';
select throws_ok($$insert into public.event_media_players (media_id, player_id) values ('f3000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'a colleague cannot tag someone else''s photo');
delete from public.event_media_players where media_id = 'f3000000-0000-4000-8000-000000000001';
reset role;
select is((select count(*)::int from public.event_media_players where media_id = 'f3000000-0000-4000-8000-000000000001'), 1,
  'a colleague cannot remove tags from someone else''s photo');

-- Even the uploader cannot remove a tag that hides a photo, not even with an unfiltered delete
select pg_temp.act_as('c3000000-0000-4000-8000-0000000000c3');
delete from public.event_media_players;
reset role;
select is((select count(*)::int from public.event_media_players where media_id = 'f3000000-0000-4000-8000-000000000002'), 1,
  'a tag that hides a photo stays until an Admin removes it');
select is((select count(*)::int from public.event_media_players where media_id = 'f3000000-0000-4000-8000-000000000001'), 0,
  'the uploader can remove their own visible tags');
select is((select name from public.events where id = 'e3000000-0000-4000-8000-000000000001'), 'MPL W3 · ONIC vs RRQ', 'another designer cannot rename it');

-- Merch designer ----------------------------------------------------------------
select pg_temp.act_as('d3000000-0000-4000-8000-0000000000d3');
select ok((select count(*) from public.events) >= 1, 'a Merch designer sees events');
select throws_ok($$insert into public.events (name) values ('Nope')$$, '42501', null, 'a Merch designer cannot create events');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('staging', (select auth.uid())::text || '/photo.jpg')$$,
  '42501', null, 'a Merch designer cannot stage files');
reset role;

-- Admin ----------------------------------------------------------------------
select pg_temp.act_as('a3000000-0000-4000-8000-0000000000a3', 'aal1');
select throws_ok($$insert into public.events (name) values ('No MFA')$$, '42501', null, 'Admin must use two-step sign-in');
reset role;
select pg_temp.act_as('a3000000-0000-4000-8000-0000000000a3', 'aal2');
select results_eq($$select count(*)::int from public.event_media where event_id = 'e3000000-0000-4000-8000-000000000001'$$, $$values (2)$$, 'Admin sees every photo');
select lives_ok($$delete from public.events where name = 'Kopdar Jakarta'$$, 'Admin deletes an event');
reset role;

-- Server registration -----------------------------------------------------------
set local role service_role;
select lives_ok($$select public.event_add_media('c3000000-0000-4000-8000-0000000000c3',
  '{"event_id":"e3000000-0000-4000-8000-000000000001","kind":"video","name":"clip","path":"e/clip.mp4","mime":"video/mp4","bytes":600000000}')$$,
  'the server registers a checked video for a Social designer');
select throws_ok($$select public.event_add_media('d3000000-0000-4000-8000-0000000000d3',
  '{"event_id":"e3000000-0000-4000-8000-000000000001","kind":"photo","name":"x","path":"e/m.jpg","mime":"image/jpeg","bytes":1}')$$,
  '42501', null, 'never for someone who may not add event files');
reset role;
set local role authenticated;
select throws_ok($$select public.event_add_media('c3000000-0000-4000-8000-0000000000c3', '{}')$$, '42501', null, 'browsers cannot call the registration function');
reset role;

select * from finish();
rollback;
