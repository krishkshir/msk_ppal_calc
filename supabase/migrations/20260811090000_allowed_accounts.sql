-- Locks this deployment to a fixed three-account allow-list. Before this,
-- /ledger was gated only on "is this a valid authenticated session" —
-- ANY email address could self-register via signInWithOtp (shouldCreateUser
-- defaults to true) and, once signed in, read the whole ledger, insert
-- fraudulent transactions, and insert fee_models rows directly (the active
-- model, which the PUBLIC / and /breakdown routes read with no session).
-- Verified live before this fix: as `authenticated` with an arbitrary
-- unknown sub, `select count(*) from public.transactions` returned all
-- rows.
--
-- The allow-list is enforced at account-creation time (handle_new_user
-- below refuses to create a profile for an unlisted email, aborting the
-- auth.users insert entirely) and again at every read/write (the policies
-- below require a profiles row, which only that trigger can create). See
-- docs/plan-ledger-access-lockdown.html for the full design writeup.

\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------------
-- allowed_accounts: the allow-list itself.
--
-- RLS is enabled with ZERO policies, which is deny-all for anon and
-- authenticated (Supabase's default privileges grant full DML on every new
-- public table to both roles, so RLS is the only thing standing here; the
-- revoke below removes the grant as well, including TRUNCATE, which RLS
-- does not cover).
--
-- Deliberately NOT referenced from any RLS policy: a policy subquery is
-- evaluated as the invoking role, so `exists (select 1 from
-- allowed_accounts ...)` inside a policy would return zero rows for every
-- client (RLS denies the read on allowed_accounts itself) and the policy
-- would be unconditionally false, silently locking the ledger for
-- everyone, admin included, with no error anywhere. Only the SECURITY
-- DEFINER trigger below (running as postgres) ever reads this table.
-- ---------------------------------------------------------------------

create table if not exists public.allowed_accounts (
  email      text primary key,
  role       text not null check (role in ('admin', 'user')),
  note       text,
  created_at timestamptz not null default now(),
  -- Fail loudly on a mistyped seed rather than storing a row that can
  -- never match GoTrue's lowercased auth.users.email.
  constraint allowed_accounts_email_normalized check (email = lower(btrim(email)))
);

alter table public.allowed_accounts enable row level security;
revoke all on public.allowed_accounts from anon, authenticated;

insert into public.allowed_accounts (email, role, note) values
  ('shrikantkshirsagar29@gmail.com', 'admin', 'Maintainer — already the sole existing account, promoted in place.'),
  ('karendlima3@gmail.com',          'user',  'Ms. K.'),
  ('krish.kshir@gmail.com',          'user',  'Maintainer''s second account.')
on conflict (email) do update set role = excluded.role;

-- ---------------------------------------------------------------------
-- Membership helpers.
--
-- SECURITY DEFINER (owner: postgres, which owns profiles and has
-- BYPASSRLS) so these do not depend on profiles' own SELECT policy. The
-- pre-existing admin policy read profiles directly and therefore worked
-- only because "users can read their own profile" happened to expose the
-- exact row it needed -- dropping or narrowing that policy would have made
-- every admin UPDATE silently affect zero rows. These decouple that.
--
-- Both take no arguments and report only on the caller, so exposing them
-- as PostgREST RPC is harmless. A helper taking an email would be a public
-- allow-list oracle -- hence the lookup stays inlined in the trigger.
-- ---------------------------------------------------------------------

create or replace function public.is_ledger_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p where p.id = (select auth.uid())
  );
$$;

create or replace function public.is_ledger_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;

revoke all on function public.is_ledger_member() from public, anon;
revoke all on function public.is_ledger_admin()  from public, anon;
grant execute on function public.is_ledger_member() to authenticated;
grant execute on function public.is_ledger_admin()  to authenticated;

-- ---------------------------------------------------------------------
-- handle_new_user: now the allow-list gate.
--
-- CREATE OR REPLACE keeps the existing on_auth_user_created trigger
-- pointing here (never DROP ... CASCADE, which would take the trigger).
-- Every attribute is restated: CREATE OR REPLACE resets unspecified
-- attributes, and losing `security definer` would break the profiles
-- insert. search_path tightened from 'public' to '' with everything
-- qualified.
--
-- The RAISE aborts GoTrue's own transaction, so no auth.users row, no
-- identity and -- critically -- no magic-link email is ever produced for an
-- unlisted address. The client gets a 500, which src/app/login/actions.ts
-- already swallows into the same generic ?sent=1 screen a success shows,
-- so this leaks nothing about which emails are listed.
--
-- Consequence to remember: this blocks EVERY insert into auth.users,
-- including the Dashboard's "Add user"/"Invite user". Adding a fourth
-- person means inserting into allowed_accounts first.
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(new.email, '')));
  v_role  text;
begin
  select a.role into v_role
  from public.allowed_accounts a
  where a.email = v_email;

  if v_role is null then
    -- Also covers email-less signups (anonymous / phone), which this
    -- deployment has no use for.
    raise exception 'account not permitted'
      using errcode = '42501',
            hint = 'This deployment is limited to a fixed set of accounts.';
  end if;

  insert into public.profiles (id, role)
  values (new.id, v_role)
  on conflict (id) do update set role = excluded.role;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Policies: membership, not merely authentication.
--
-- Before this, ANY authenticated JWT could read every transaction --
-- verified: `set local role authenticated` with an arbitrary sub still
-- returned all 3 rows. `to authenticated` is kept as a cheap short-circuit
-- for anon; is_ledger_member() is the actual gate. Calls are wrapped in
-- (select ...) so they evaluate once per statement, not once per row --
-- same reason the v0.5 migration writes (select auth.uid()).
--
-- Both old and new policy names are dropped so re-running this file is
-- idempotent (Postgres has no CREATE OR REPLACE POLICY).
--
-- fee_models' SELECT policy is deliberately untouched: the public
-- calculator and /breakdown read the active model with no session.
-- ---------------------------------------------------------------------

drop policy if exists "authenticated can read all transactions"    on public.transactions;
drop policy if exists "ledger accounts can read all transactions"  on public.transactions;
create policy "ledger accounts can read all transactions"
on public.transactions for select
to authenticated
using ( (select public.is_ledger_member()) );

drop policy if exists "authenticated can record a new transaction"   on public.transactions;
drop policy if exists "ledger accounts can record a new transaction" on public.transactions;
create policy "ledger accounts can record a new transaction"
on public.transactions for insert
to authenticated
with check ( is_seed = false and (select public.is_ledger_member()) );

drop policy if exists "admin can correct or exclude a transaction" on public.transactions;
create policy "admin can correct or exclude a transaction"
on public.transactions for update
to authenticated
using      ( (select public.is_ledger_admin()) )
with check ( (select public.is_ledger_admin()) );

drop policy if exists "authenticated can accept a fee model"   on public.fee_models;
drop policy if exists "ledger accounts can accept a fee model" on public.fee_models;
create policy "ledger accounts can accept a fee model"
on public.fee_models for insert
to authenticated
with check ( accepted_by = (select auth.uid()) and (select public.is_ledger_member()) );

-- ---------------------------------------------------------------------
-- Reconcile. Writes to public.profiles, not auth.users, so
-- on_auth_user_created cannot fire here.
--
-- As of writing, auth.users holds exactly one account
-- (shrikantkshirsagar29@gmail.com, role 'user') and it IS on the allow-list
-- (as 'admin') -- so (a) promotes it in place, and (b) is a no-op.
-- ---------------------------------------------------------------------

-- (a) allow-listed accounts that already exist get the mapped role.
insert into public.profiles (id, role)
select u.id, a.role
from auth.users u
join public.allowed_accounts a on a.email = lower(btrim(u.email))
on conflict (id) do update set role = excluded.role;

-- (b) every other profile row goes away. Without a profiles row, all four
-- policies above deny, and getCurrentUser() (after the app fix) returns
-- null. The auth.users row itself is left alone -- deleting an account is a
-- separate, irreversible decision, taken by hand.
delete from public.profiles p
where not exists (
  select 1
  from auth.users u
  join public.allowed_accounts a on a.email = lower(btrim(u.email))
  where u.id = p.id
);

commit;
