begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

-- Start from an installation with no Admin (other test data may exist locally).
delete from public.user_roles where role = 'admin';

insert into auth.users (id, email, aud, role) values
  ('f0000000-0000-4000-8000-00000000000f', 'first@onic.test', 'authenticated', 'authenticated'),
  ('f1000000-0000-4000-8000-00000000000f', 'second@onic.test', 'authenticated', 'authenticated');

set local role authenticated;
select throws_ok($$select private.bootstrap_admin('first@onic.test', 'First')$$, '42501', null, 'signed-in users cannot run the bootstrap');
reset role;

select lives_ok($$select private.bootstrap_admin('first@onic.test', 'First')$$, 'the database owner creates the first Admin');
select ok(exists (select 1 from public.user_roles where user_id = 'f0000000-0000-4000-8000-00000000000f' and role = 'admin'), 'first Admin has the Admin role');
select throws_ok($$select private.bootstrap_admin('second@onic.test', 'Second')$$, 'P0001', null, 'it refuses once an Admin exists');

select * from finish();
rollback;
