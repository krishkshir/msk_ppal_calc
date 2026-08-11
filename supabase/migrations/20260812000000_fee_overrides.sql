-- v0.6: manual rate/fee overrides. See docs/plan-v0.6.html "Schema" for
-- the design this implements.
--
-- Append-only, matching fee_models' own philosophy
-- (20260810160000_v0_5_ledger.sql): no update and no delete policy below,
-- so RLS denies both outright, not just by app-layer convention. Clearing
-- an override inserts a tombstone row (cleared = true, value = null)
-- rather than deleting or mutating the row it supersedes — the same
-- exclude-don't-delete rule this project applies to transactions.

create table public.fee_overrides (
  id uuid primary key default gen_random_uuid(),
  -- "rate:OTHER:0" | "fixedFee:CAD" | "fxSpread" — src/lib/fees/overrides.ts's
  -- targetKey()/parseTargetKey() are the source of truth for this grammar;
  -- this check is a defense-in-depth mirror of it, not a replacement —
  -- the app always re-validates a target_key against the live
  -- SCHEDULE/CURRENCIES tables before trusting it.
  target_key text not null check (
    target_key = 'fxSpread'
    or target_key ~ '^rate:[A-Z_]+:[0-9]+$'
    or target_key ~ '^fixedFee:[A-Z]{3}$'
  ),
  -- Rate/spread as a fraction, fixed fee as integer minor units — the
  -- same units src/lib/fees/overrides.ts's Override.value uses. Null
  -- exactly when cleared = true (a tombstone carries no value).
  value numeric,
  cleared boolean not null default false,
  check ( (cleared and value is null) or (not cleared and value is not null) ),
  -- The date the figure actually took effect (typed by whoever set it) —
  -- distinct from set_at below, which is when the row was saved.
  effective_from date not null,
  note text,
  set_at timestamptz not null default now(),
  set_by uuid references auth.users (id),
  set_by_email text,
  created_at timestamptz not null default now()
);

create index fee_overrides_target_key_idx on public.fee_overrides (target_key, set_at desc);

alter table public.fee_overrides enable row level security;

-- ---------------------------------------------------------------------
-- set_by / set_by_email are stamped server-side from auth.uid(), never
-- trusted from client-submitted form fields (the same reasoning
-- acceptFeeModel's accepted_by column relies on RLS's `with check
-- (accepted_by = auth.uid())` for — here a trigger is used instead so the
-- INSERT policy below doesn't also need to require the client to submit
-- the right uid). SECURITY DEFINER (owner: postgres) so it can read
-- auth.users regardless of the caller's own grants — safe here because,
-- like 20260811120000_derive_ledger_access.sql's helpers, this reports
-- only on auth.uid()/the row being inserted, never taking an
-- attacker-controlled identity as a parameter. Relies on postgres
-- carrying rolbypassrls (a Supabase platform property already relied on
-- by that same migration), not something this migration establishes.
-- ---------------------------------------------------------------------

create function public.stamp_fee_override_setter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.set_by := (select auth.uid());
  new.set_by_email := (select u.email from auth.users u where u.id = (select auth.uid()));
  new.set_at := now();
  return new;
end;
$$;

create trigger fee_overrides_stamp_setter
before insert on public.fee_overrides
for each row execute function public.stamp_fee_override_setter();

-- ---------------------------------------------------------------------
-- SELECT: the public calculator (/) and /breakdown both need to read
-- active overrides with no login — the same reasoning fee_models' SELECT
-- policy documents. But set_by_email must not become a publicly readable
-- list of ledger members' email addresses. RLS is row-level only, so
-- hiding one column of an otherwise-public row needs Postgres
-- column-level grants underneath a permissive policy, not RLS alone.
-- ---------------------------------------------------------------------

create policy "anyone can read fee overrides"
on public.fee_overrides for select
to anon, authenticated
using ( true );

revoke select on public.fee_overrides from anon;
grant select (id, target_key, value, cleared, effective_from, note, set_at)
  on public.fee_overrides to anon;
grant select on public.fee_overrides to authenticated; -- full row, incl. set_by/set_by_email

-- ---------------------------------------------------------------------
-- INSERT: any ledger member (user or admin) can set or clear an override
-- — deliberately not role-gated, per docs/plan-v0.6.html's confirmed
-- decision that correcting a published rate or fee is not the kind of
-- data-quality judgment call (excluding a transaction, reverting a
-- model) this app otherwise reserves for admin. Mirrors the insert
-- policy pattern on public.transactions
-- (20260811090000_allowed_accounts.sql).
-- ---------------------------------------------------------------------

create policy "ledger members can set or clear a fee override"
on public.fee_overrides for insert
to authenticated
with check ( (select public.is_ledger_member()) );

-- No update, no delete policy: RLS denies both outright. Clearing an
-- override is a fresh insert (cleared = true), never a mutation of an
-- existing row.
