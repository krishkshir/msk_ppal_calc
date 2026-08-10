import { cache } from "react";
import { isCurrency, type Currency } from "@/lib/fees/currencies";
import type { ActiveFeeModelRow } from "@/lib/fees/model";
import { createClient } from "./supabase-server";

interface FeeModelRow {
  rate: number;
  fixed_fee_minor_units: number;
  fx_spread_rate: number;
  per_currency_fixed_fees: Record<string, number>;
  confidence: "observed" | "estimated" | "unvalidated";
  fx_spread_confidence: "observed" | "estimated" | "unvalidated";
  accepted_at: string;
}

/**
 * The active model — the most recently accepted fee_models row — or null
 * if the table is empty or the database is unreachable. Null is the
 * signal engine.ts's `model` field treats as "fall back to the static
 * schedule.ts/currencies.ts constants entirely" (src/lib/fees/model.ts),
 * so a Supabase outage degrades the public calculator and /breakdown to
 * their pre-v0.5 behavior rather than breaking them — see
 * docs/plan-v0.5.html "Engine change".
 *
 * anon-readable by RLS (fee_models' select policy) — this is safe to call
 * from a public route with no session.
 *
 * Wrapped in React's cache() so a route that calls this more than once
 * per request (src/app/breakdown/page.tsx calls it from both
 * generateMetadata and the page body) issues one DB query, not two.
 */
export const getActiveFeeModel = cache(async (): Promise<ActiveFeeModelRow | null> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("fee_models")
      .select(
        "rate, fixed_fee_minor_units, fx_spread_rate, per_currency_fixed_fees, confidence, fx_spread_confidence, accepted_at",
      )
      .order("accepted_at", { ascending: false })
      .limit(1)
      .maybeSingle<FeeModelRow>();

    if (error || !data) {
      return null;
    }

    const perCurrencyFixedFees: Partial<Record<Currency, number>> = {};
    for (const [code, minorUnits] of Object.entries(data.per_currency_fixed_fees)) {
      if (isCurrency(code)) {
        perCurrencyFixedFees[code] = minorUnits;
      }
    }

    return {
      rate: data.rate,
      fixedFeeMinorUnits: data.fixed_fee_minor_units,
      fxSpreadRate: data.fx_spread_rate,
      perCurrencyFixedFees,
      confidence: data.confidence,
      fxSpreadConfidence: data.fx_spread_confidence,
      asOf: data.accepted_at.slice(0, 10), // matches SCHEDULE_EFFECTIVE_FROM's YYYY-MM-DD shape
    };
  } catch {
    // Network failure, missing env vars in a preview environment, etc. —
    // same fallback as an empty table, not a thrown error the public
    // calculator would surface to a client.
    return null;
  }
});

export interface FeeModelHistoryEntry {
  id: string;
  rate: number;
  fixedFeeMinorUnits: number;
  fxSpreadRate: number;
  confidence: "observed" | "estimated" | "unvalidated";
  acceptedAt: string;
  note: string | null;
}

/** Authenticated-only route (the /ledger history view) — fee_models itself is anon-readable, but this lives behind the ledger gate regardless. */
export async function listFeeModelHistory(): Promise<FeeModelHistoryEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fee_models")
    .select("id, rate, fixed_fee_minor_units, fx_spread_rate, confidence, accepted_at, note")
    .order("accepted_at", { ascending: false })
    .returns<
      Array<{
        id: string;
        rate: number;
        fixed_fee_minor_units: number;
        fx_spread_rate: number;
        confidence: "observed" | "estimated" | "unvalidated";
        accepted_at: string;
        note: string | null;
      }>
    >();

  if (error || !data) {
    return [];
  }
  return data.map((row) => ({
    id: row.id,
    rate: row.rate,
    fixedFeeMinorUnits: row.fixed_fee_minor_units,
    fxSpreadRate: row.fx_spread_rate,
    confidence: row.confidence,
    acceptedAt: row.accepted_at,
    note: row.note,
  }));
}

export interface AcceptFeeModel {
  rate: number;
  fixedFeeMinorUnits: number;
  fxSpreadRate: number;
  confidence: "observed" | "estimated" | "unvalidated";
  sourceTransactionIds: string[];
  acceptedBy: string;
  note: string;
}

/** RLS requires accepted_by = auth.uid() — a spoofed acceptedBy fails at the database. */
export async function acceptFeeModel(input: AcceptFeeModel): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("fee_models").insert({
    rate: input.rate,
    fixed_fee_minor_units: input.fixedFeeMinorUnits,
    fx_spread_rate: input.fxSpreadRate,
    confidence: input.confidence,
    source_transaction_ids: input.sourceTransactionIds,
    accepted_by: input.acceptedBy,
    note: input.note,
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
