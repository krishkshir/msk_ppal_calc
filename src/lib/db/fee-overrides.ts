import { cache } from "react";
import type { ActiveOverrides, Override } from "@/lib/fees/overrides";
import { createClient } from "./supabase-server";

interface FeeOverrideRow {
  target_key: string;
  value: number | null;
  cleared: boolean;
  effective_from: string;
  note: string | null;
  set_at: string;
}

function mapRow(data: FeeOverrideRow): Override {
  return {
    targetKey: data.target_key,
    // Non-null by the table's own check constraint whenever cleared is
    // false, which is the only case a row reaches here (see
    // newestNonClearedByTarget below).
    value: data.value as number,
    effectiveFrom: data.effective_from,
    setByEmail: null, // anon-granted columns don't include set_by_email — see the migration's column grants
    setAt: data.set_at,
    note: data.note,
  };
}

/** Collapses a target_key's full row history to its newest non-cleared row, per target. Shared by getActiveOverrides and getActiveOverridesWithSetter below — the same reduction, over two different row shapes. */
function newestNonClearedByTarget<T extends { target_key: string; cleared: boolean }>(rows: T[]): T[] {
  const newestByTarget = new Map<string, T>();
  for (const row of rows) {
    if (!newestByTarget.has(row.target_key)) {
      newestByTarget.set(row.target_key, row);
    }
  }
  return [...newestByTarget.values()].filter((row) => !row.cleared);
}

/**
 * The newest non-cleared row per target_key — [] on any error, empty
 * table, or unreachable database, so a Supabase outage degrades to the
 * ledger model and then the static table (src/lib/fees/model.ts's
 * resolveFeeModel) rather than breaking the public calculator or
 * /breakdown. Same degrade-gracefully contract as
 * src/lib/db/fee-models.ts's getActiveFeeModel.
 *
 * anon-readable by RLS (fee_overrides' select policy) — safe to call from
 * a public route with no session, though set_by_email is never present
 * on the object this returns (anon lacks the grant for that column; see
 * the migration).
 *
 * Wrapped in cache() so a route that reads the active model more than
 * once per request (src/app/breakdown/page.tsx's generateMetadata + page
 * body) issues one query for overrides too, not two.
 */
export const getActiveOverrides = cache(async (): Promise<ActiveOverrides> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("fee_overrides")
      .select("target_key, value, cleared, effective_from, note, set_at")
      .order("set_at", { ascending: false })
      .returns<FeeOverrideRow[]>();

    if (error || !data) {
      return [];
    }

    return newestNonClearedByTarget(data).map(mapRow);
  } catch {
    return [];
  }
});

interface FeeOverrideHistoryRow extends FeeOverrideRow {
  set_by_email: string | null;
}

function mapHistoryRow(data: FeeOverrideHistoryRow): Override {
  return { ...mapRow(data), setByEmail: data.set_by_email };
}

/**
 * The same "newest non-cleared row per target" resolution as
 * getActiveOverrides, but the authenticated-only variant that also
 * carries setByEmail — for the /ledger rates table's "set by <email>"
 * display (docs/plan-v0.6.html "The table"). Kept separate from
 * getActiveOverrides, which stays anon-safe and is shared by the public
 * calculator and /breakdown: selecting set_by_email there would fail the
 * whole query for an anon caller, who has no grant on that column (see
 * the migration's column-level grants).
 */
export async function getActiveOverridesWithSetter(): Promise<ActiveOverrides> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fee_overrides")
    .select("target_key, value, cleared, effective_from, note, set_at, set_by_email")
    .order("set_at", { ascending: false })
    .returns<FeeOverrideHistoryRow[]>();

  if (error || !data) {
    return [];
  }
  return newestNonClearedByTarget(data).map(mapHistoryRow);
}

export interface SetOverrideInput {
  targetKey: string;
  value: number;
  effectiveFrom: string;
  note: string | null;
}

/** set_by/set_by_email/set_at are stamped server-side by a trigger (see the migration) — never taken from this input. */
export async function setOverride(input: SetOverrideInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("fee_overrides").insert({
    target_key: input.targetKey,
    value: input.value,
    cleared: false,
    effective_from: input.effectiveFrom,
    note: input.note,
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Inserts a tombstone row (cleared = true) — fee_overrides is append-only, so clearing never deletes or updates the row it supersedes. */
export async function clearOverride(targetKey: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("fee_overrides").insert({
    target_key: targetKey,
    value: null,
    cleared: true,
    // effective_from is not-null at the DB level; "now" is the only
    // meaningful date for a tombstone, which has no value of its own to
    // date.
    effective_from: new Date().toISOString().slice(0, 10),
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
