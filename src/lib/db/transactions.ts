import { isCurrency, type Currency } from "@/lib/fees/currencies";
import { createClient } from "./supabase-server";

export interface TransactionRow {
  id: string;
  grossPaidMinorUnits: number;
  payCurrency: Currency;
  receivedUSDMinorUnits: number;
  buyerCountry: string;
  paidOn: string | null;
  paypalFeeMinorUnits: number | null;
  paypalFxRate: number | null;
  fxReferenceRate: number | null;
  isSeed: boolean;
  excludedReason: string | null;
  note: string | null;
  createdAt: string;
}

interface RawTransactionRow {
  id: string;
  gross_paid_minor_units: number;
  pay_currency: string;
  received_usd_minor_units: number;
  buyer_country: string;
  paid_on: string | null;
  paypal_fee_minor_units: number | null;
  paypal_fx_rate: number | null;
  fx_reference_rate: number | null;
  is_seed: boolean;
  excluded_reason: string | null;
  note: string | null;
  created_at: string;
}

function fromRaw(row: RawTransactionRow): TransactionRow | null {
  if (!isCurrency(row.pay_currency)) {
    return null; // defensive: a currency retired from CURRENCIES shouldn't crash the ledger view
  }
  return {
    id: row.id,
    grossPaidMinorUnits: row.gross_paid_minor_units,
    payCurrency: row.pay_currency,
    receivedUSDMinorUnits: row.received_usd_minor_units,
    buyerCountry: row.buyer_country,
    paidOn: row.paid_on,
    paypalFeeMinorUnits: row.paypal_fee_minor_units,
    paypalFxRate: row.paypal_fx_rate,
    fxReferenceRate: row.fx_reference_rate,
    isSeed: row.is_seed,
    excludedReason: row.excluded_reason,
    note: row.note,
    createdAt: row.created_at,
  };
}

/** Authenticated-only by RLS (transactions' select policy) — never called from a public route. */
export async function listTransactions(): Promise<TransactionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select(
      "id, gross_paid_minor_units, pay_currency, received_usd_minor_units, buyer_country, paid_on, paypal_fee_minor_units, paypal_fx_rate, fx_reference_rate, is_seed, excluded_reason, note, created_at",
    )
    .order("created_at", { ascending: true })
    .returns<RawTransactionRow[]>();

  if (error || !data) {
    return [];
  }
  return data.map(fromRaw).filter((row): row is TransactionRow => row !== null);
}

export interface NewTransaction {
  grossPaidMinorUnits: number;
  payCurrency: Currency;
  receivedUSDMinorUnits: number;
  buyerCountry: string;
  paidOn: string | null;
  paypalFeeMinorUnits: number | null;
  paypalFxRate: number | null;
  fxReferenceRate: number | null;
  fxReferenceDate: string | null;
  note: string | null;
}

/** RLS enforces is_seed=false and the authenticated-only insert policy — this never needs to check the role itself. */
export async function recordTransaction(input: NewTransaction): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("transactions").insert({
    gross_paid_minor_units: input.grossPaidMinorUnits,
    pay_currency: input.payCurrency,
    received_usd_minor_units: input.receivedUSDMinorUnits,
    buyer_country: input.buyerCountry,
    paid_on: input.paidOn,
    paypal_fee_minor_units: input.paypalFeeMinorUnits,
    paypal_fx_rate: input.paypalFxRate,
    fx_reference_rate: input.fxReferenceRate,
    fx_reference_date: input.fxReferenceDate,
    note: input.note,
    is_seed: false,
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** RLS restricts this to role='admin' — a non-admin call fails at the database, not just the UI. */
export async function excludeTransaction(
  id: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("transactions")
    .update({ excluded_reason: reason })
    .eq("id", id);

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
