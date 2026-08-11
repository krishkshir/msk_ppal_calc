"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireUser } from "@/lib/auth/profile";
import { acceptFeeModel, getActiveFeeModel, getFeeModelById } from "@/lib/db/fee-models";
import { clearOverride, setOverride } from "@/lib/db/fee-overrides";
import { excludeTransaction, recordTransaction } from "@/lib/db/transactions";
import { isCurrency } from "@/lib/fees/currencies";
import { parseTargetKey, targetKey, validateEffectiveFrom, validateOverrideValue } from "@/lib/fees/overrides";
import { isQuotedTier } from "@/lib/fees/schedule";
import { parseAmountToMinorUnits } from "@/lib/format";
import { getFxRateToUSD } from "@/lib/fx/frankfurter";
import { loadLedgerStatus } from "./status";

export async function recordTransactionAction(formData: FormData) {
  const user = await requireUser("/ledger");

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

  let paypalFxRate: number | null = null;
  if (paypalFxRateInput !== "") {
    paypalFxRate = Number(paypalFxRateInput);
    if (!Number.isFinite(paypalFxRate) || paypalFxRate <= 0) {
      return fail("PayPal's exchange rate must be a positive number.");
    }
  }

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
    paypalFxRate,
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
 * either role can accept. A server action is a public POST endpoint, so
 * the rate/fixedFee/sourceTransactionIds being accepted are never taken
 * from client-submitted form fields (a caller could otherwise post
 * arbitrary figures straight into the live, anon-readable fee_models
 * table — see the v0.4.x share-link "Trust boundary" precedent this
 * mirrors). Instead this recomputes the ledger status from the real,
 * current transactions and only proceeds if that fresh computation still
 * says "propose".
 */
export async function acceptProposalAction() {
  const user = await requireUser("/ledger");

  const [{ status }, active] = await Promise.all([loadLedgerStatus(), getActiveFeeModel()]);
  if (status.commercial.kind !== "propose") {
    // Stale form (e.g. someone else already accepted, or a new
    // transaction changed the verdict) — nothing to accept anymore.
    redirect("/ledger");
  }

  const { proposedModel, sourceTransactionIds } = status.commercial;
  const result = await acceptFeeModel({
    rate: (proposedModel.rateLo + proposedModel.rateHi) / 2,
    fixedFeeMinorUnits: proposedModel.fixedFeeMinorUnits,
    fxSpreadRate: active?.fxSpreadRate ?? 0.04,
    perCurrencyFixedFees: active?.perCurrencyFixedFees ?? {},
    confidence: "observed",
    fxSpreadConfidence: active?.fxSpreadConfidence ?? "estimated",
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
  await requireAdmin("/ledger");

  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || "Excluded by admin";
  if (id) {
    await excludeTransaction(id, reason);
  }
  revalidatePath("/ledger");
  redirect("/ledger");
}

/**
 * Admin-only "revert" — reinserts a prior model's figures as a fresh row,
 * keeping fee_models append-only rather than mutating history. Only the
 * target row's id is taken from the form; its rate/fixedFee/spread/
 * per-currency fees/confidence are all looked up fresh from that row
 * (getFeeModelById) rather than trusted from hidden form fields, for the
 * same reason acceptProposalAction above recomputes rather than trusts.
 */
export async function revertToModelAction(formData: FormData) {
  const user = await requireAdmin("/ledger");

  const id = String(formData.get("id") ?? "");
  const target = await getFeeModelById(id);
  if (!target) {
    redirect("/ledger");
  }

  await acceptFeeModel({
    rate: target.rate,
    fixedFeeMinorUnits: target.fixedFeeMinorUnits,
    fxSpreadRate: target.fxSpreadRate,
    perCurrencyFixedFees: target.perCurrencyFixedFees,
    confidence: target.confidence,
    fxSpreadConfidence: target.fxSpreadConfidence,
    sourceTransactionIds: [],
    acceptedBy: user.id,
    note: `Reverted by admin ${user.email ?? user.id} to a prior accepted model (originally accepted ${target.asOf}).`,
  });

  revalidatePath("/ledger");
  revalidatePath("/");
  revalidatePath("/breakdown");
  redirect("/ledger");
}

/**
 * Either role can set an override (docs/plan-v0.6.html "Override targets"
 * — confirmed decision: correcting a published rate or fee is not the
 * kind of data-quality judgment call this app reserves for admin). The
 * posted target_key is re-parsed against the real SCHEDULE/CURRENCIES
 * tables (parseTargetKey), not trusted as-is — the same
 * re-read-server-side guard acceptProposalAction/revertToModelAction
 * apply, since a form field is attacker-editable. The typed value is a
 * percentage for a rate/spread target ("4.625" meaning 4.625%) or a
 * major-unit money amount for a fixed-fee target ("0.31"), matching what
 * the rates table displays — converted to the engine's storage units
 * (a fraction, or integer minor units via currencySpec's
 * minorUnitExponent) here, in one place, so the JPY-exponent trap
 * (CLAUDE.md "Domain model") can't be mishandled per call site.
 */
export async function setOverrideAction(formData: FormData) {
  await requireUser("/ledger");

  const fail = (error: string) => redirect(`/ledger?error=${encodeURIComponent(error)}`);

  const targetKeyRaw = String(formData.get("targetKey") ?? "");
  const target = parseTargetKey(targetKeyRaw);
  if (!target) {
    return fail("Unrecognized rate or fee.");
  }
  if (target.kind === "rate" && !isQuotedTier(target.buyerMarket, target.minMonthlyVolumeUSDCents)) {
    return fail("That volume tier isn't used for quoting.");
  }

  const valueInput = String(formData.get("value") ?? "").trim();
  const effectiveFrom = String(formData.get("effectiveFrom") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;

  if (valueInput === "") {
    return fail("Enter a valid figure.");
  }

  let value: number | null;
  if (target.kind === "fixedFee") {
    value = parseAmountToMinorUnits(valueInput, target.currency);
  } else {
    const percent = Number(valueInput);
    value = Number.isFinite(percent) ? percent / 100 : null;
  }
  if (value == null) {
    return fail("Enter a valid figure.");
  }

  const valueError = validateOverrideValue(target, value);
  if (valueError) {
    return fail(valueError);
  }
  const dateError = validateEffectiveFrom(effectiveFrom);
  if (dateError) {
    return fail(dateError);
  }

  const result = await setOverride({ targetKey: targetKey(target), value, effectiveFrom, note });
  if (!result.ok) {
    return fail(result.error);
  }

  revalidatePath("/ledger");
  revalidatePath("/");
  revalidatePath("/breakdown");
  redirect("/ledger");
}

/** Either role can clear an override — see setOverrideAction's doc comment. Inserts a tombstone row (fee_overrides is append-only); never deletes. */
export async function clearOverrideAction(formData: FormData) {
  await requireUser("/ledger");

  const targetKeyRaw = String(formData.get("targetKey") ?? "");
  const target = parseTargetKey(targetKeyRaw);
  if (target) {
    await clearOverride(targetKey(target));
  }

  revalidatePath("/ledger");
  revalidatePath("/");
  revalidatePath("/breakdown");
  redirect("/ledger");
}
