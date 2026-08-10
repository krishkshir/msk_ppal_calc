"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/profile";
import { acceptFeeModel, getActiveFeeModel } from "@/lib/db/fee-models";
import { excludeTransaction, recordTransaction } from "@/lib/db/transactions";
import { isCurrency } from "@/lib/fees/currencies";
import { parseAmountToMinorUnits } from "@/lib/format";
import { getFxRateToUSD } from "@/lib/fx/frankfurter";

export async function recordTransactionAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/ledger");

  // A plain <form action={...}> server action must return void, not a
  // value (useActionState is the API for surfacing per-field errors) —
  // so validation failures redirect back to the form with an ?error=
  // query param, matching src/app/login/page.tsx's existing sent=1
  // pattern rather than introducing a second error-reporting convention.
  // `return fail(...)` (not a bare `fail(...)` statement) so TypeScript's
  // control-flow narrowing sees each guarded value as validated below.
  const fail = (error: string) => redirect(`/ledger/new?error=${encodeURIComponent(error)}`);

  const payCurrencyRaw = String(formData.get("payCurrency") ?? "");
  if (!isCurrency(payCurrencyRaw)) {
    return fail("Unrecognized currency.");
  }
  const payCurrency = payCurrencyRaw;
  const grossInput = String(formData.get("grossPaid") ?? "");
  const receivedInput = String(formData.get("receivedUSD") ?? "");
  const grossPaidMinorUnitsRaw = parseAmountToMinorUnits(grossInput, payCurrency);
  const receivedUSDMinorUnitsRaw = parseAmountToMinorUnits(receivedInput, "USD");
  const buyerCountry = String(formData.get("buyerCountry") ?? "").trim();
  const paidOn = String(formData.get("paidOn") ?? "").trim() || null;
  const paypalFeeInput = String(formData.get("paypalFee") ?? "").trim();
  const paypalFxRateInput = String(formData.get("paypalFxRate") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;

  if (grossPaidMinorUnitsRaw == null || grossPaidMinorUnitsRaw <= 0) {
    return fail("Enter what the client paid.");
  }
  if (receivedUSDMinorUnitsRaw == null || receivedUSDMinorUnitsRaw < 0) {
    return fail("Enter what you received, in USD.");
  }
  if (!buyerCountry) {
    return fail("Enter the buyer's country.");
  }
  const grossPaidMinorUnits = grossPaidMinorUnitsRaw;
  const receivedUSDMinorUnits = receivedUSDMinorUnitsRaw;

  const paypalFeeMinorUnits =
    paypalFeeInput === "" ? null : parseAmountToMinorUnits(paypalFeeInput, payCurrency);

  let fxReferenceRate: number | null = null;
  let fxReferenceDate: string | null = null;
  if (payCurrency !== "USD" && paidOn) {
    try {
      const rate = await getFxRateToUSD(payCurrency, paidOn);
      fxReferenceRate = rate.rate;
      fxReferenceDate = rate.asOf;
    } catch {
      // The transaction is still worth recording without a reference
      // rate — the ledger status panel simply can't use it toward the
      // FX-spread solve until this is backfilled.
    }
  }

  const result = await recordTransaction({
    grossPaidMinorUnits,
    payCurrency,
    receivedUSDMinorUnits,
    buyerCountry,
    paidOn,
    paypalFeeMinorUnits,
    paypalFxRate: paypalFxRateInput ? Number(paypalFxRateInput) : null,
    fxReferenceRate,
    fxReferenceDate,
    note,
  });

  if (!result.ok) {
    return fail(result.error);
  }
  revalidatePath("/ledger");
  redirect("/ledger");
}

/**
 * Self-service by design (docs/plan-v0.5.html "Accounts and access") —
 * either role can accept. `sourceTransactionIds`/rate/fixedFee/note are
 * hidden fields set by the status panel from the exact verdict it just
 * rendered, so acceptance can't drift from what the user actually saw.
 */
export async function acceptProposalAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/ledger");

  const rate = Number(formData.get("rate"));
  const fixedFeeMinorUnits = Number(formData.get("fixedFeeMinorUnits"));
  const sourceTransactionIds = String(formData.get("sourceTransactionIds") ?? "")
    .split(",")
    .filter(Boolean);

  const active = await getActiveFeeModel();
  const result = await acceptFeeModel({
    rate,
    fixedFeeMinorUnits,
    fxSpreadRate: active?.fxSpreadRate ?? 0.04,
    confidence: "observed",
    sourceTransactionIds,
    acceptedBy: user.id,
    note: `Accepted from the ledger's commercial-rate proposal by ${user.email ?? user.id}.`,
  });

  if (result.ok) {
    revalidatePath("/ledger");
    revalidatePath("/");
    revalidatePath("/breakdown");
  }
  redirect("/ledger");
}

/** RLS restricts the underlying update to role='admin'; this check just fails fast with a clearer redirect. */
export async function excludeTransactionAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") redirect("/login?next=/ledger");

  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || "Excluded by admin";
  if (id) {
    await excludeTransaction(id, reason);
  }
  revalidatePath("/ledger");
  redirect("/ledger");
}

/** Admin-only "revert" — reinserts a prior model's figures as a fresh row, keeping fee_models append-only rather than mutating history. */
export async function revertToModelAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") redirect("/login?next=/ledger");

  const rate = Number(formData.get("rate"));
  const fixedFeeMinorUnits = Number(formData.get("fixedFeeMinorUnits"));
  const fxSpreadRate = Number(formData.get("fxSpreadRate"));

  await acceptFeeModel({
    rate,
    fixedFeeMinorUnits,
    fxSpreadRate,
    confidence: "observed",
    sourceTransactionIds: [],
    acceptedBy: user.id,
    note: `Reverted by admin ${user.email ?? user.id} to a prior accepted model.`,
  });

  revalidatePath("/ledger");
  revalidatePath("/");
  revalidatePath("/breakdown");
  redirect("/ledger");
}
