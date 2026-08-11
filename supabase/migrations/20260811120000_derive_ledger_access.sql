-- Makes public.allowed_accounts the single, LIVE source of truth for
-- ledger access. The prior migration (20260811090000_allowed_accounts.sql)
-- materialized allow-list membership into public.profiles once, at first
-- sign-up (handle_new_user, an AFTER INSERT ON auth.users trigger — by
-- definition it never fires again for an existing account). That made
-- profiles a denormalized CACHE of allowed_accounts, and the cache was
-- never invalidated: `delete from allowed_accounts` did NOT revoke access
-- (the matching profiles row, and therefore is_ledger_member(), survived
-- untouched) and `update allowed_accounts set role=...` never reached an
-- already-registered account. Both contradicted this project's own
-- CLAUDE.md ("adding or removing a person is insert/delete on
-- allowed_accounts") and src/lib/auth/profile.ts's doc comment — found by
-- code review before either was ever exercised for real.
--
-- A sync trigger (INSERT/UPDATE/DELETE on allowed_accounts writing
-- profiles) was designed and rejected: a bare UPDATE-on-role no-ops once a
-- profiles row has been deleted by a revoke, permanently locking out
-- anyone re-added after removal — the identical bug shape, one level down.
-- Fixing that requires an upsert, email normalization, soft-deleted
-- auth.users handling, and a reconcile step to converge whatever drift
-- already exists — permanent new surface to keep correct.
--
-- Deriving instead has no cache to invalidate, so no invalidation bug is
-- possible: my_ledger_role() below reads allowed_accounts joined to
-- auth.users fresh, every call. This also closes a residual risk the
-- original design only accepted (see docs/plan-ledger-access-lockdown.html):
-- authorization used to key off profiles.id, so a user could
-- updateUser({email}) to an unlisted address and keep access. It now keys
-- off the live auth.users.email, so that move self-revokes, fail-closed.
--
-- Apply with: psql "$POSTGRES_URL_NON_POOLING" -v ON_ERROR_STOP=1 -f <this file>
-- (no \set ON_ERROR_STOP here, unlike the prior migration — that's a psql
-- meta-command, which breaks applying this file through the Supabase SQL
-- editor or any non-psql tool. The begin/commit block below already
-- guarantees atomicity regardless of that flag; the flag only affects
-- whether psql stops immediately on an error instead of spewing follow-on
-- errors from the now-aborted transaction.)

begin;

-- ---------------------------------------------------------------------
-- my_ledger_role(): the one source of truth. is_ledger_member() and
-- is_ledger_admin() below both delegate to it — one body to keep correct
-- instead of three.
--
-- SECURITY DEFINER (owner: postgres) for two distinct reasons:
--   - public.allowed_accounts is owned by postgres, so the owner is exempt
--     from its own RLS regardless of role attributes. NEVER add `force row
--     level security` to allowed_accounts or profiles' would-be successor
--     here — that single statement would silently make every helper below
--     return null for everyone, the exact failure mode the prior
--     migration's own comments warn about.
--   - auth.users is owned by supabase_auth_admin, NOT postgres — that read
--     relies specifically on postgres carrying rolbypassrls (a Supabase
--     platform property, not something this migration establishes; already
--     relied on by the prior migration's reconcile step). The deploy guard
--     below fails loudly if that assumption stops holding.
--
-- Zero arguments, reports only on auth.uid(), so PostgREST exposure (this
-- is callable as /rpc/my_ledger_role by any authenticated caller) is
-- harmless. NEVER add an email parameter — that turns this into a public
-- allow-list membership oracle for any authenticated caller, which is
-- exactly why the original allow-list lookup stays inlined in
-- handle_new_user() below rather than becoming a callable helper.
-- ---------------------------------------------------------------------

create or replace function public.my_ledger_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.role
  from auth.users u
  join public.allowed_accounts a
    on a.email = lower(btrim(u.email))  -- allowed_accounts.email is already
                                          -- normalized by its check constraint;
                                          -- auth.users.email is not guaranteed.
  where u.id = (select auth.uid())
    and u.deleted_at is null             -- soft-deleted accounts are not members
  limit 1;                               -- auth.users is not unique on email
$$;

-- Thin wrappers so the existing transactions/fee_models policies (which
-- call these by name) keep working unchanged — this migration swaps their
-- implementation, not the policies themselves.
--
-- coalesce on the admin one: without it, a non-member's `null = 'admin'`
-- comparison yields null, which a policy USING correctly treats as deny,
-- but which would silently poison any future `not is_ledger_admin()`
-- expression into always-null instead of always-true-for-non-admins.
create or replace function public.is_ledger_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select public.my_ledger_role() is not null; $$;

create or replace function public.is_ledger_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select coalesce(public.my_ledger_role() = 'admin', false); $$;

revoke all on function public.my_ledger_role()   from public, anon;
revoke all on function public.is_ledger_member() from public, anon;
revoke all on function public.is_ledger_admin()  from public, anon;
grant execute on function public.my_ledger_role()   to authenticated;
grant execute on function public.is_ledger_member() to authenticated;
grant execute on function public.is_ledger_admin()  to authenticated;

-- ---------------------------------------------------------------------
-- handle_new_user is now purely the signup gate — it no longer
-- materializes anything into profiles, because there is nothing left to
-- materialize (my_ledger_role() reads allowed_accounts live). CREATE OR
-- REPLACE (never DROP ... CASCADE) keeps on_auth_user_created attached;
-- every attribute is restated because CREATE OR REPLACE resets unspecified
-- ones.
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.allowed_accounts a
    where a.email = lower(btrim(coalesce(new.email, '')))
  ) then
    -- Also covers email-less signups (anonymous / phone), which this
    -- deployment has no use for.
    raise exception 'account not permitted'
      using errcode = '42501',
            hint = 'This deployment is limited to a fixed set of accounts.';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Deploy guard. If postgres ever loses visibility into auth.users, every
-- helper above returns null and the ledger denies EVERYONE, silently and
-- with no error anywhere — fail the deploy here instead of discovering it
-- as a silent lockout later.
--
-- Skipped when auth.users has no live rows (a fresh branch or preview DB),
-- where zero matches is the correct answer rather than a symptom.
-- ---------------------------------------------------------------------

do $$
begin
  if exists (select 1 from auth.users where deleted_at is null)
     and not exists (
       select 1
       from auth.users u
       join public.allowed_accounts a on a.email = lower(btrim(u.email))
       where u.deleted_at is null
     )
  then
    raise exception
      'refusing to switch authorization to allowed_accounts: % live auth.users row(s), none matching the allow-list -- check that postgres can read auth.users (rolbypassrls) and that emails match',
      (select count(*) from auth.users where deleted_at is null);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- profiles is now a stale copy of a live table with no readers: no FK
-- targets it (transactions.created_by and fee_models.accepted_by both
-- reference auth.users directly), and src/lib/auth/profile.ts — its only
-- application reader — moves to my_ledger_role() in this same change.
-- Leaving it would leave a `role` column that looks authoritative and
-- isn't, which is how the bug this migration fixes happened in the first
-- place.
--
-- No CASCADE, deliberately: its own SELECT policy drops with the table,
-- and anything else that turns out to depend on it should fail loudly here
-- rather than be silently dropped along with it.
-- ---------------------------------------------------------------------

drop table if exists public.profiles;

commit;
