import { roundHalfUpCents } from "./money";
import {
  ACCOUNT_CURRENCY,
  FX_SPREAD_RATE,
  SCHEDULE_EFFECTIVE_FROM,
  selectTier,
} from "./schedule";
import type { BuyerMarket, Breakdown, Confidence, Currency, FeeLineItem, Money } from "./types";

interface CommonInput {
  payCurrency: Currency;
  buyerMarket: BuyerMarket;
  /** Trailing monthly sales volume in USD cents — not this transaction's size. */
  monthlyVolumeUSDCents: number;
  /**
   * Units of USD per 1 unit of payCurrency, at the base (pre-spread)
   * market rate. Required whenever payCurrency !== ACCOUNT_CURRENCY;
   * the engine does no fetching of its own (Frankfurter integration is
   * a v0.2 concern), so the caller supplies it.
   */
  fxBaseRateToUSD?: number;
}

export interface SettleInput extends CommonInput {
  grossPaidCents: number;
}

export interface QuoteInput extends CommonInput {
  /** What Ms. K wants to net, in USD cents. */
  netTargetCents: number;
}

export interface QuoteResult {
  invoiceAmount: Money;
  breakdown: Breakdown;
}

/**
 * PayPal's fixed fee is only observed in USD. For any other payCurrency
 * it's estimated by converting the USD figure at the base FX rate —
 * PayPal's actual per-currency fixed-fee table is unpublished
 * (CONSTITUTION.md open question #2), so this is a documented estimate,
 * not a lookup.
 */
function resolveFixedFeeCents(
  fixedFeeUSDCents: number,
  payCurrency: Currency,
  fxBaseRateToUSD: number | undefined,
): number {
  if (payCurrency === ACCOUNT_CURRENCY) {
    return fixedFeeUSDCents;
  }
  if (fxBaseRateToUSD == null) {
    throw new Error(
      `fxBaseRateToUSD is required to estimate the ${payCurrency} fixed fee`,
    );
  }
  return roundHalfUpCents(fixedFeeUSDCents / fxBaseRateToUSD);
}

/**
 * A tier's confidence describes its rate, which is only ever observed in
 * USD. Applying it to any other payCurrency means the fixed-fee portion
 * was estimated by conversion (see resolveFixedFeeCents), so an
 * "observed" tier can't honestly stay "observed" once currency
 * conversion is involved — it downgrades to "estimated". A tier that's
 * already "unvalidated" stays that way; it can't get worse.
 */
function confidenceFor(tierConfidence: Confidence, payCurrency: Currency): Confidence {
  if (payCurrency === ACCOUNT_CURRENCY) {
    return tierConfidence;
  }
  return tierConfidence === "observed" ? "estimated" : tierConfidence;
}

/**
 * What actually lands in Ms. K's account, given what the client paid.
 * Two deductions apply in order: PayPal's commercial transaction fee
 * (charged in the payment currency), then — only if the client paid in
 * a currency other than the account's — the currency-conversion spread
 * on the remainder. See CONSTITUTION.md "Design principles".
 */
export function settle(input: SettleInput): Breakdown {
  const { grossPaidCents, payCurrency, buyerMarket, monthlyVolumeUSDCents, fxBaseRateToUSD } =
    input;
  const tier = selectTier(buyerMarket, monthlyVolumeUSDCents);
  const fixedFeeCents = resolveFixedFeeCents(
    tier.fixedFeeUSDCents,
    payCurrency,
    fxBaseRateToUSD,
  );

  const commercialFeeCents = roundHalfUpCents(grossPaidCents * tier.rate + fixedFeeCents);
  const netInPayCurrencyCents = grossPaidCents - commercialFeeCents;

  const fixedFeeIsEstimated = payCurrency !== ACCOUNT_CURRENCY;
  const commercialFee: FeeLineItem = {
    label: `Cross-border transaction fee (${(tier.rate * 100).toFixed(3)}% + fixed)`,
    cents: commercialFeeCents,
    currency: payCurrency,
    confidence: confidenceFor(tier.confidence, payCurrency),
    note: fixedFeeIsEstimated
      ? `${tier.note ?? ""} The ${payCurrency} fixed fee is estimated by converting ` +
        `the observed USD fixed fee at the base FX rate — PayPal's actual ` +
        `${payCurrency} fixed fee is unpublished (CONSTITUTION.md open question #2).`
      : tier.note,
  };

  if (payCurrency === ACCOUNT_CURRENCY) {
    return {
      grossPaid: { currency: payCurrency, cents: grossPaidCents },
      commercialFee,
      fxConversion: null,
      received: { currency: ACCOUNT_CURRENCY, cents: netInPayCurrencyCents },
      ratesAsOf: SCHEDULE_EFFECTIVE_FROM,
    };
  }

  if (fxBaseRateToUSD == null) {
    throw new Error(
      `fxBaseRateToUSD is required when payCurrency (${payCurrency}) differs ` +
        `from the account currency (${ACCOUNT_CURRENCY})`,
    );
  }

  const atBaseRateCents = roundHalfUpCents(netInPayCurrencyCents * fxBaseRateToUSD);
  const receivedCents = roundHalfUpCents(
    netInPayCurrencyCents * fxBaseRateToUSD * (1 - FX_SPREAD_RATE),
  );
  const fxConversion: FeeLineItem = {
    label: `Currency conversion spread (${(FX_SPREAD_RATE * 100).toFixed(1)}% above base rate)`,
    cents: atBaseRateCents - receivedCents,
    currency: ACCOUNT_CURRENCY,
    confidence: "estimated",
    note:
      "No observed transaction involves a currency conversion — this line " +
      "item is PayPal's published 4.0% MEA-region spread applied as-is, " +
      "not validated against a real payment.",
  };

  return {
    grossPaid: { currency: payCurrency, cents: grossPaidCents },
    commercialFee,
    fxConversion,
    received: { currency: ACCOUNT_CURRENCY, cents: receivedCents },
    ratesAsOf: SCHEDULE_EFFECTIVE_FROM,
  };
}

/**
 * What to invoice to net a target amount. Not `net / (1 - rate)` — the
 * fixed fee and the FX spread apply at different points in the chain
 * and must be unwound in the reverse of settle()'s order. Rounds the
 * invoice amount up to the cent so Ms. K never nets less than her
 * target; settle(quote(n).invoiceAmount) is therefore >= n, not exactly
 * n, given cent rounding on both ends.
 */
export function quote(input: QuoteInput): QuoteResult {
  const { netTargetCents, payCurrency, buyerMarket, monthlyVolumeUSDCents, fxBaseRateToUSD } =
    input;
  const tier = selectTier(buyerMarket, monthlyVolumeUSDCents);
  const fixedFeeCents = resolveFixedFeeCents(
    tier.fixedFeeUSDCents,
    payCurrency,
    fxBaseRateToUSD,
  );

  let netInPayCurrencyCents: number;
  if (payCurrency === ACCOUNT_CURRENCY) {
    netInPayCurrencyCents = netTargetCents;
  } else {
    if (fxBaseRateToUSD == null) {
      throw new Error(
        `fxBaseRateToUSD is required when payCurrency (${payCurrency}) differs ` +
          `from the account currency (${ACCOUNT_CURRENCY})`,
      );
    }
    netInPayCurrencyCents = netTargetCents / (fxBaseRateToUSD * (1 - FX_SPREAD_RATE));
  }

  const grossCentsExact = (netInPayCurrencyCents + fixedFeeCents) / (1 - tier.rate);
  // Round up, guarding against floating-point noise landing just under
  // an exact cent boundary (which would otherwise round up unnecessarily).
  const grossCents = Math.ceil(grossCentsExact - 1e-9);

  const breakdown = settle({
    grossPaidCents: grossCents,
    payCurrency,
    buyerMarket,
    monthlyVolumeUSDCents,
    fxBaseRateToUSD,
  });

  return {
    invoiceAmount: { currency: payCurrency, cents: grossCents },
    breakdown,
  };
}
