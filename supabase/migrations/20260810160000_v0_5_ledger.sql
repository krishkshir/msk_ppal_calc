-- v0.5: transaction ledger + re-derivable fee model.
-- See docs/plan-v0.5.html "Schema (Supabase Postgres)" and "Accounts and
-- access" for the design this implements.

-- ---------------------------------------------------------------------
-- profiles: one row per auth.users row, carrying the admin/user role.
-- Role lives here (not auth.users.raw_user_meta_data, which is
-- user-editable and unsafe for authorization — see the Supabase security
-- checklist) and not in raw_app_meta_data either, since nothing in this
-- app needs the role inside a JWT claim; a table lookup is simpler and
-- avoids JWT staleness after a role change.
-- ---------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'user' check (role in ('admin', 'user')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "users can read their own profile"
on public.profiles for select
to authenticated
using ( (select auth.uid()) = id );

-- No insert/update/delete policy for authenticated users: role is a
-- privilege boundary, not self-service. A profile row is created
-- automatically on signup (trigger below) with role='user'; promoting
-- Ms. K's or the admin's account to 'admin' is a one-time manual step run
-- by the maintainer directly in the Supabase SQL editor, per
-- docs/plan-v0.5.html "Accounts and access" — deliberately not a UI
-- feature nobody asked for.

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role) values (new.id, 'user');
  return new;
end;
$$;
-- security definer is genuinely needed here (inserting into public.profiles
-- from an auth.users trigger, which runs with no other role to check
-- against) and is safe from the "callable by anon/authenticated" trap the
-- security checklist warns about: Postgres only invokes a trigger-typed
-- function as a trigger, so `select handle_new_user()` is rejected outright.

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- transactions: the append-only validation set. Rows are excluded, never
-- deleted (docs/CONSTITUTION.md's append-don't-replace rule) — there is
-- deliberately no delete policy below, so RLS denies it outright.
-- ---------------------------------------------------------------------

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  gross_paid_minor_units integer not null check (gross_paid_minor_units > 0),
  pay_currency text not null check (char_length(pay_currency) = 3),
  received_usd_minor_units integer not null check (received_usd_minor_units >= 0),
  buyer_country text not null,
  -- Nullable: T1-T3 (docs/CONSTITUTION.md "Observed transactions") predate
  -- this ledger and their exact payment dates were never recorded —
  -- inventing one would violate this project's own "don't invent data"
  -- rule. Only a currency conversion actually needs paid_on (to fetch the
  -- ECB rate for that day); it's optional for every transaction.
  paid_on date,
  funds_available_on date,
  -- PayPal's own fee line and exchange rate, read directly off the
  -- transaction when Ms. K can see them — these are what let a non-USD
  -- transaction pin its currency's fixed fee or the FX spread exactly,
  -- instead of only bounding them (see src/lib/fees/solve.ts).
  paypal_fee_minor_units integer,
  paypal_fx_rate numeric,
  -- The ECB reference rate on paid_on, cached at entry time so the
  -- solver's math doesn't depend on Frankfurter still being reachable
  -- (or still agreeing with itself) later.
  fx_reference_rate numeric,
  fx_reference_date date,
  excluded_reason text,
  is_seed boolean not null default false,
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index transactions_paid_on_idx on public.transactions (paid_on);

alter table public.transactions enable row level security;

create policy "authenticated can read all transactions"
on public.transactions for select
to authenticated
using ( true );

-- Any authenticated account can record a new, non-seed transaction —
-- this is the self-service path the whole feature exists for. Seed rows
-- (T1-T3) can only ever be created by this migration's own insert below,
-- never through the app.
create policy "authenticated can record a new transaction"
on public.transactions for insert
to authenticated
with check ( is_seed = false );

-- Excluding/correcting a transaction (including editing T1-T3) is a
-- data-quality judgment call reserved for the admin account — see
-- docs/plan-v0.5.html "Accounts and access". UPDATE needs both USING and
-- WITH CHECK (Supabase security checklist) or a user could otherwise
-- reassign is_seed/created_by away from what the check implies.
create policy "admin can correct or exclude a transaction"
on public.transactions for update
to authenticated
using ( exists (
  select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'
) )
with check ( exists (
  select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'
) );

-- ---------------------------------------------------------------------
-- fee_models: append-only history of accepted models. Every row is
-- already-accepted by construction (there is no separate draft/proposal
-- row — propose.ts computes a proposal live from `transactions` on each
-- ledger page load and never persists it until someone accepts it); the
-- active model is simply the row with the latest accepted_at. "Reverting"
-- to a prior model means inserting a fresh row that copies its figures
-- forward, keeping the history genuinely append-only rather than mutating
-- an old row's accepted_at.
--
-- INSERT here is authenticated-only, not role-gated, even though
-- docs/plan-v0.5.html's capability table reserves "revert to a prior
-- model" for the admin account: at the RLS layer, an accept-a-new-
-- proposal insert and a revert-by-reinsertion insert are the same
-- operation (both are "insert a row"), and the two accounts here are
-- both already-trusted, authenticated users of a two-person app — RLS's
-- job is keeping fee_models writes away from anon entirely. The
-- accept-vs-revert role distinction is enforced where it actually has the
-- context to be meaningful: the ledger's server actions in src/lib/db,
-- which know which UI action triggered the insert.
-- ---------------------------------------------------------------------

create table public.fee_models (
  id uuid primary key default gen_random_uuid(),
  rate numeric not null,
  fixed_fee_minor_units integer not null,
  fx_spread_rate numeric not null,
  per_currency_fixed_fees jsonb not null default '{}'::jsonb,
  confidence text not null check (confidence in ('observed', 'estimated', 'unvalidated')),
  source_transaction_ids uuid[] not null default '{}',
  accepted_at timestamptz not null default now(),
  accepted_by uuid references auth.users (id),
  note text,
  created_at timestamptz not null default now()
);

create index fee_models_accepted_at_idx on public.fee_models (accepted_at desc);

alter table public.fee_models enable row level security;

-- The rate itself isn't a secret — the public calculator and /breakdown
-- both need to read the active model with no login.
create policy "anyone can read fee models"
on public.fee_models for select
to anon, authenticated
using ( true );

create policy "authenticated can accept a fee model"
on public.fee_models for insert
to authenticated
with check ( accepted_by = (select auth.uid()) );

-- ---------------------------------------------------------------------
-- Seed data: T1-T3 (docs/CONSTITUTION.md "Observed transactions") and the
-- currently committed model (schedule.ts / currencies.ts as of v0.4).
-- Reproducing today's calculator output exactly from this seed is the
-- first verification step in docs/plan-v0.5.html.
-- ---------------------------------------------------------------------

insert into public.transactions
  (gross_paid_minor_units, pay_currency, received_usd_minor_units, buyer_country, is_seed, note)
values
  (8300, 'USD', 7885, 'US', true, 'T1 — docs/CONSTITUTION.md "Observed transactions"'),
  (10120, 'USD', 9621, 'US', true, 'T2 — docs/CONSTITUTION.md "Observed transactions"'),
  (12000, 'USD', 11414, 'US', true, 'T3 — docs/CONSTITUTION.md "Observed transactions"');

insert into public.fee_models
  (rate, fixed_fee_minor_units, fx_spread_rate, confidence, accepted_at, note)
values
  (
    0.04625,
    31,
    0.04,
    'observed',
    '2026-05-28T00:00:00Z',
    'Seed: the model committed in src/lib/fees/schedule.ts and currencies.ts as of v0.4 — 4.625% + $0.31, from T1-T3.'
  );
