-- Who can see and change what. Every role tries to cross team lines and skip approval; all must fail.
begin;
create extension if not exists pgtap with schema extensions;
select plan(54);

-- Start from a clean set of people (other local data may exist); everything rolls back at the end.
delete from public.user_roles;

-- People ---------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-00000000000a', 'admin@onic.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-4000-8000-00000000000b', 'hod@onic.test', 'authenticated', 'authenticated'),
  ('c0000000-0000-4000-8000-00000000000c', 'social@onic.test', 'authenticated', 'authenticated'),
  ('d0000000-0000-4000-8000-00000000000d', 'merch@onic.test', 'authenticated', 'authenticated'),
  ('e0000000-0000-4000-8000-00000000000e', 'gone@onic.test', 'authenticated', 'authenticated');

insert into public.profiles (id, org_id, team_id, full_name, email, disabled) values
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000001', null, 'Admin', 'admin@onic.test', false),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-000000000001', null, 'Head of Design', 'hod@onic.test', false),
  ('c0000000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-000000000001', (select id from public.teams where slug = 'social'), 'Social', 'social@onic.test', false),
  ('d0000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-000000000001', (select id from public.teams where slug = 'merch'), 'Merch', 'merch@onic.test', false),
  ('e0000000-0000-4000-8000-00000000000e', '00000000-0000-4000-8000-000000000001', (select id from public.teams where slug = 'social'), 'Gone', 'gone@onic.test', true);

insert into public.user_roles (user_id, role) values
  ('a0000000-0000-4000-8000-00000000000a', 'admin'),
  ('b0000000-0000-4000-8000-00000000000b', 'admin'),
  ('b0000000-0000-4000-8000-00000000000b', 'approver'),
  ('c0000000-0000-4000-8000-00000000000c', 'social_designer'),
  ('d0000000-0000-4000-8000-00000000000d', 'merch_designer'),
  ('e0000000-0000-4000-8000-00000000000e', 'social_designer');

insert into public.jobs (id, team_id, type, title, created_by) values
  ('10000000-0000-4000-8000-000000000001', (select id from public.teams where slug = 'social'), 'feed_post', 'Social job', 'c0000000-0000-4000-8000-00000000000c'),
  ('20000000-0000-4000-8000-000000000002', (select id from public.teams where slug = 'merch'), 'theme', 'Merch job', 'd0000000-0000-4000-8000-00000000000d');

-- Impersonation helper: role + JWT claims for the rest of the transaction.
create function pg_temp.act_as(uid uuid, aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.act_as_server() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end $$;

-- Every public table has RLS ------------------------------------------------
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0, 'every table in public has row-level security on');

-- Social Designer -------------------------------------------------------------
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c');
select results_eq('select title from public.jobs', $$values ('Social job')$$, 'Social Designer sees only social jobs');
select throws_ok(
  $$insert into public.jobs (team_id, type, title) values ((select id from public.teams where slug = 'merch'), 'theme', 'sneaky')$$,
  '42501', null, 'Social Designer cannot create a merch job');
select lives_ok(
  $$insert into public.jobs (team_id, type, title) values ((select id from public.teams where slug = 'social'), 'feed_post', 'mine')$$,
  'Social Designer can create a social job');
update public.jobs set title = 'hijacked' where id = '20000000-0000-4000-8000-000000000002';
select throws_ok($$update public.jobs set state = 'APPROVED' where id = '10000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'state column cannot be written directly');
select throws_ok($$update public.jobs set team_id = team_id where true$$, '42501', null, 'team cannot be changed directly');
select throws_ok($$select public.transition_job('20000000-0000-4000-8000-000000000002', 'RUNNING')$$,
  '42501', null, 'Social Designer cannot start a merch job');
select lives_ok($$select public.transition_job('10000000-0000-4000-8000-000000000001', 'RUNNING')$$,
  'Social Designer can start their own job');
select throws_ok($$select public.transition_job('10000000-0000-4000-8000-000000000001', 'QC_PASSED')$$,
  '42501', null, 'a designer cannot mark QC as passed');
select is_empty('select 1 from public.audit_log', 'Social Designer cannot read the audit log');
select is_empty('select 1 from public.settings', 'Social Designer cannot read settings');
select throws_ok($$insert into public.settings (key, value) values ('x', '1')$$, '42501', null, 'Social Designer cannot write settings');
select results_eq('select user_id from public.user_roles', $$values ('c0000000-0000-4000-8000-00000000000c'::uuid)$$,
  'Social Designer sees only their own roles');
select results_eq($$select count(*)::int from public.profiles where email like '%@onic.test' and id in
  ('a0000000-0000-4000-8000-00000000000a','b0000000-0000-4000-8000-00000000000b','c0000000-0000-4000-8000-00000000000c',
   'd0000000-0000-4000-8000-00000000000d','e0000000-0000-4000-8000-00000000000e')$$, $$values (2)$$, 'Social Designer sees only social teammates');
select throws_ok($$insert into public.jobs (team_id, type, title, budget_credits) values ((select id from public.teams where slug = 'social'), 'feed_post', 'rich', 999999)$$,
  '42501', null, 'designers cannot set their own credit budget');
select throws_ok($$update public.jobs set budget_credits = 999999 where team_id = (select id from public.teams where slug = 'social')$$,
  '42501', null, 'designers cannot raise a budget later');
select throws_ok($$insert into public.jobs (team_id, type, title, created_by) values ((select id from public.teams where slug = 'social'), 'feed_post', 'as someone else', 'd0000000-0000-4000-8000-00000000000d')$$,
  '42501', null, 'designers cannot create jobs in someone else''s name');
select throws_ok($$select public.rate_limit_hit(auth.uid(), 'x', 1, 60)$$, '42501', null, 'rate limiter is server-only');
select throws_ok($$select public.revoke_user_sessions('a0000000-0000-4000-8000-00000000000a')$$, '42501', null, 'session revocation is server-only');
select throws_ok($$select public.audit_event(auth.uid(), 'fake', null, '{}')$$, '42501', null, 'designers cannot write to the audit log');
reset role;
select is((select title from public.jobs where id = '20000000-0000-4000-8000-000000000002'), 'Merch job',
  'the Social Designer''s update to a merch job changed nothing');

-- Server moves the social job through QC ----------------------------------------
select pg_temp.act_as_server();
select lives_ok($$select public.transition_job('10000000-0000-4000-8000-000000000001', 'QC_PASSED')$$, 'server can record QC passed');
reset role;

select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c');
select throws_ok($$select public.transition_job('10000000-0000-4000-8000-000000000001', 'APPROVED')$$,
  '42501', null, 'a designer cannot skip approval');
select lives_ok($$select public.transition_job('10000000-0000-4000-8000-000000000001', 'PENDING_APPROVAL')$$,
  'designer sends the job for approval');
select throws_ok($$select public.transition_job('10000000-0000-4000-8000-000000000001', 'APPROVED')$$,
  '42501', null, 'a designer cannot approve their own job');
reset role;

-- Merch Designer --------------------------------------------------------------
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d');
select results_eq('select title from public.jobs', $$values ('Merch job')$$, 'Merch Designer sees only merch jobs');
select throws_ok($$select public.transition_job('10000000-0000-4000-8000-000000000001', 'REJECTED', 'no')$$,
  '42501', null, 'Merch Designer cannot reject a social job');
reset role;

-- Head of Design without two-step sign-in ------------------------------------------
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', 'aal1');
select is_empty('select 1 from public.jobs', 'Approver sees nothing until two-step sign-in');
select is_empty('select 1 from public.profiles', 'Approver sees no people until two-step sign-in');
select throws_ok($$select public.transition_job('10000000-0000-4000-8000-000000000001', 'APPROVED')$$,
  '42501', null, 'Approver cannot approve without two-step sign-in');
select results_eq('select needs_mfa from public.my_access()', $$values (true)$$, 'my_access tells the app to ask for a code');
reset role;

-- Head of Design with two-step sign-in -------------------------------------------
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', 'aal2');
select results_eq($$select count(*)::int from public.jobs where title in ('Social job', 'Merch job', 'mine')$$, $$values (3)$$, 'Approver sees jobs from both teams');
select throws_ok($$select public.transition_job('10000000-0000-4000-8000-000000000001', 'REJECTED', '  ')$$,
  '22023', null, 'a rejection needs a note');
select lives_ok($$select public.transition_job('10000000-0000-4000-8000-000000000001', 'APPROVED')$$, 'Approver approves');
select throws_ok($$select public.transition_job('10000000-0000-4000-8000-000000000001', 'SCHEDULED')$$,
  '42501', null, 'not even the Approver can schedule; only the server');
select ok((select count(*) from public.audit_log where action = 'job.approved') = 1, 'approval is in the audit log');
reset role;

-- Nobody approves their own work ----------------------------------------------------
reset role;
insert into public.jobs (id, team_id, type, title, created_by, state) values
  ('30000000-0000-4000-8000-000000000003', (select id from public.teams where slug = 'social'), 'feed_post', 'HoD job', 'b0000000-0000-4000-8000-00000000000b', 'DRAFT');
select set_config('onic.transition', 'on', true);
update public.jobs set state = 'PENDING_APPROVAL' where id = '30000000-0000-4000-8000-000000000003';
select set_config('onic.transition', 'off', true);
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', 'aal2');
select throws_ok($$select public.transition_job('30000000-0000-4000-8000-000000000003', 'APPROVED')$$,
  '42501', null, 'the Approver cannot approve a job they created');
reset role;

-- People management functions -------------------------------------------------------
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', 'aal2');
select throws_ok($$select public.admin_set_disabled('a0000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-00000000000c', true)$$,
  '42501', null, 'people-management functions are server-only');
reset role;
select pg_temp.act_as_server();
select throws_ok($$select public.admin_update_user('a0000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-00000000000c', null, false, null, array['approver','social_designer']::public.app_role[])$$,
  '22023', null, 'a designer cannot also be an Approver');
select lives_ok($$select public.admin_set_disabled('a0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000b', true)$$,
  'one Admin can turn another off while an Admin remains');
select throws_ok($$select public.admin_set_disabled('b0000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-00000000000a', true)$$,
  'P0001', null, 'the last active Admin cannot be turned off');
select ok((select actor = 'a0000000-0000-4000-8000-00000000000a' from public.audit_log where action = 'user.disabled' order by id desc limit 1),
  'the audit log names the Admin who turned the account off');
select lives_ok($$select public.admin_set_disabled('a0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000b', false)$$, 'and back on');
reset role;

-- Admin -----------------------------------------------------------------------
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', 'aal1');
select throws_ok($$insert into public.settings (key, value) values ('daily_cap', '5')$$, '42501', null,
  'Admin cannot change settings without two-step sign-in');
reset role;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', 'aal2');
select lives_ok($$insert into public.settings (key, value) values ('daily_cap', '5')$$, 'Admin with two-step sign-in can change settings');
select isnt_empty('select 1 from public.audit_log', 'Admin can read the audit log');
select throws_ok($$select public.transition_job('10000000-0000-4000-8000-000000000001', 'FINAL')$$,
  '42501', null, 'Admin without the Approver role cannot finalise');
select throws_ok($$delete from public.audit_log$$, '42501', null, 'Admin cannot delete audit entries');
reset role;

-- Audit log is append-only even for the database owner ---------------------------
select throws_ok($$update public.audit_log set action = 'x'$$, 'P0001', 'audit_log is append-only', 'owner cannot edit the audit log');
select throws_ok($$delete from public.job_transitions$$, 'P0001', 'job history is append-only', 'owner cannot delete job history');

-- Disabled account ----------------------------------------------------------------
select pg_temp.act_as('e0000000-0000-4000-8000-00000000000e');
select is_empty('select 1 from public.jobs', 'a disabled account sees nothing');
select throws_ok(
  $$insert into public.jobs (team_id, type, title) values ((select id from public.teams where slug = 'social'), 'feed_post', 'x')$$,
  '42501', null, 'a disabled account cannot create jobs');
reset role;

-- Not signed in ---------------------------------------------------------------------
set local role anon;
select throws_ok('select 1 from public.jobs', '42501', null, 'visitors who are not signed in get nothing');
select throws_ok('select * from public.my_access()', '42501', null, 'visitors cannot call my_access');
reset role;

select * from finish();
rollback;
