-- Sub-brands: everyone reads the list, only an Admin with two-step sign-in adds to it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

delete from public.user_roles;

insert into auth.users (id, email, aud, role) values
  ('a2000000-0000-4000-8000-0000000000a2', 'sb-admin@onic.test', 'authenticated', 'authenticated'),
  ('c2000000-0000-4000-8000-0000000000c2', 'sb-social@onic.test', 'authenticated', 'authenticated');
insert into public.profiles (id, org_id, team_id, full_name, email) values
  ('a2000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000001', null, 'SB Admin', 'sb-admin@onic.test'),
  ('c2000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-000000000001', (select id from public.teams where slug = 'social'), 'SB Social', 'sb-social@onic.test');
insert into public.user_roles (user_id, role) values
  ('a2000000-0000-4000-8000-0000000000a2', 'admin'),
  ('c2000000-0000-4000-8000-0000000000c2', 'social_designer');

create function pg_temp.act_as(uid uuid, aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.act_as('c2000000-0000-4000-8000-0000000000c2');
select ok((select count(*) from public.sub_brands where name = 'ONIC PH') = 1, 'a designer sees the sub-brand list');
select throws_ok($$insert into public.sub_brands (name) values ('ONIC MY')$$, '42501', null, 'a designer cannot add a sub-brand');
reset role;

select pg_temp.act_as('a2000000-0000-4000-8000-0000000000a2', 'aal1');
select throws_ok($$insert into public.sub_brands (name) values ('ONIC MY')$$, '42501', null, 'Admin must use two-step sign-in to add a sub-brand');
reset role;

select pg_temp.act_as('a2000000-0000-4000-8000-0000000000a2', 'aal2');
select lives_ok($$insert into public.sub_brands (name) values ('ONIC MY')$$, 'Admin adds a sub-brand');
select is((select created_by from public.sub_brands where name = 'ONIC MY'), 'a2000000-0000-4000-8000-0000000000a2'::uuid, 'the new sub-brand records who added it');
select throws_ok($$insert into public.sub_brands (name) values ('onic my')$$, '23505', null, 'the same name twice is refused, whatever the capitals');
select throws_ok($$insert into public.sub_brands (name) values ('  ')$$, '23514', null, 'a blank name is refused');
select throws_ok($$insert into public.sub_brands (name, created_by) values ('ONIC X', 'c2000000-0000-4000-8000-0000000000c2')$$,
  '42501', null, 'nobody can claim someone else added it');
reset role;

select * from finish();
rollback;
