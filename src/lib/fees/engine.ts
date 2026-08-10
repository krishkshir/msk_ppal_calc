import { currencySpec } from "./currencies";
import { roundHalfUp } from "./money";
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
   * Units of USD per 1 MAJOR unit of payCurrency, at the base
   * (pre-spread) market rate — e.g. USD per 1 CAD dollar, or USD per 1
   * JPY yen. Required whenever payCurrency !== ACCOUNT_CURRENCY; the
   * engine does no fetching of its own (Frankfurter integration is a
   * v0.2 concern), so the caller supplies it. Internally converted to a
   * per-minor-unit rate via fxRateInMinorUnits, which corrects for
   * payCurrency having a different minor-unit exponent than USD (e.g.
   * JPY, exponent 0) — a plain multiply against minor units would be off
   * by a power of ten for any currency whose exponent doesn't match
   * USD's.
   */
  fxBaseRateToUSD?: number;
}

export interface SettleInput extends CommonInput {
  grossPaidMinorUnits: number;
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
 * A tier's confidence describes its rate, which is only ever observed in
 * USD. For any other payCurrency, the commercial fee also carries that
 * currency's fixed fee — and only USD's fixed fee is observed
 * (currencies.ts); every other currency's is PayPal's published,
 * unvalidated figure. So an "observed" tier can't honestly stay
 * "observed" once a non-USD fixed fee is involved — it downgrades to
 * "estimated". A tier that's already "unvalidated" stays that way; it
 * can't get worse.
 */
function confidenceFor(tierConfidence: Confidence, payCurrency: Currency): Confidence {
  if (payCurrency === ACCOUNT_CURRENCY) {
    return tierConfidence;
  }
  return tierConfidence === "observed" ? "estimated" : tierConfidence;
}

/**
 * fxBaseRateToUSD is USD per 1 major unit of payCurrency, but the engine
 * operates entirely in minor units. Converting minor-unit amounts
 * directly by that rate is only correct when payCurrency's minor-unit
 * exponent matches USD's (2) — true for every currency here except JPY
 * (exponent 0). This scales the rate so it can be applied directly to
 * minor-unit amounts regardless of exponent.
 */
function fxRateInMinorUnits(fxBaseRateToUSD: number, payCurrency: Currency): number {
  const payCurrencyExponent = currencySpec(payCurrency).minorUnitExponent;
  const usdExponent = currencySpec(ACCOUNT_CURRENCY).minorUnitExponent;
  return fxBaseRateToUSD * 10 ** (usdExponent - payCurrencyExponent);
}

/**
 * What actually lands in Ms. K's account, given what the client paid.
 * Two deductions apply in order: PayPal's commercial transaction fee
 * (charged in the payment currency), then — only if the client paid in
 * a currency other than the account's — the currency-conversion spread
 * on the remainder. See CONSTITUTION.md "Design principles".
 */
export function settle(input: SettleInput): Breakdown {
  const { grossPaidMinorUnits, payCurrency, buyerMarket, monthlyVolumeUSDCents, fxBaseRateToUSD } =
    input;
  const tier = selectTier(buyerMarket, monthlyVolumeUSDCents);
  const fixedFeeMinorUnits = currencySpec(payCurrency).fixedFeeMinorUnits;

  const commercialFeeMinorUnits = roundHalfUp(grossPaidMinorUnits * tier.rate + fixedFeeMinorUnits);
  const netInPayCurrencyMinorUnits = grossPaidMinorUnits - commercialFeeMinorUnits;

  if (netInPayCurrencyMinorUnits < 0) {
    throw new Error(
      `grossPaidMinorUnits (${grossPaidMinorUnits}) is smaller than the commercial fee it ` +
        `would incur (${commercialFeeMinorUnits} ${payCurrency} minor units) — settle() cannot ` +
        `return a negative received amount.`,
    );
  }

  const fixedFeeIsUnvalidated = payCurrency !== ACCOUNT_CURRENCY;
  const commercialFee: FeeLineItem = {
    label: `Cross-border transaction fee (${(tier.rate * 100).toFixed(3)}% + fixed)`,
    minorUnits: commercialFeeMinorUnits,
    currency: payCurrency,
    confidence: confidenceFor(tier.confidence, payCurrency),
    note: fixedFeeIsUnvalidated
      ? `${tier.note ?? ""} The ${payCurrency} fixed fee is PayPal's published figure, ` +
        `unvalidated by observation (CONSTITUTION.md open question #1).`
      : tier.note,
  };

  if (payCurrency === ACCOUNT_CURRENCY) {
    return {
      grossPaid: { currency: payCurrency, minorUnits: grossPaidMinorUnits },
      commercialFee,
      fxConversion: null,
      received: { currency: ACCOUNT_CURRENCY, minorUnits: netInPayCurrencyMinorUnits },
      ratesAsOf: SCHEDULE_EFFECTIVE_FROM,
    };
  }

  if (fxBaseRateToUSD == null) {
    throw new Error(
      `fxBaseRateToUSD is required when payCurrency (${payCurrency}) differs ` +
        `from the account currency (${ACCOUNT_CURRENCY})`,
    );
  }

  const fxRate = fxRateInMinorUnits(fxBaseRateToUSD, payCurrency);
  const atBaseRateMinorUnits = roundHalfUp(netInPayCurrencyMinorUnits * fxRate);
  const receivedMinorUnits = roundHalfUp(netInPayCurrencyMinorUnits * fxRate * (1 - FX_SPREAD_RATE));
  const fxConversion: FeeLineItem = {
    label: `Currency conversion spread (${(FX_SPREAD_RATE * 100).toFixed(1)}% above base rate)`,
    minorUnits: atBaseRateMinorUnits - receivedMinorUnits,
    currency: ACCOUNT_CURRENCY,
    confidence: "estimated",
    note:
      "No observed transaction involves a currency conversion — this line " +
      "item is PayPal's published 4.0% MEA-region spread applied as-is, " +
      "not validated against a real payment.",
  };

  return {
    grossPaid: { currency: payCurrency, minorUnits: grossPaidMinorUnits },
    commercialFee,
    fxConversion,
    received: { currency: ACCOUNT_CURRENCY, minorUnits: receivedMinorUnits },
    ratesAsOf: SCHEDULE_EFFECTIVE_FROM,
  };
}

/**
 * What to invoice to net a target amount. Not `net / (1 - rate)` — the
 * fixed fee and the FX spread apply at different points in the chain
 * and must be unwound in the reverse of settle()'s order. Rounds the
 * invoice amount up to the minor unit so Ms. K never nets less than her
 * target; settle(quote(n).invoiceAmount) is therefore >= n, not exactly
 * n, given rounding on both ends.
 */
export function quote(input: QuoteInput): QuoteResult {
  const { netTargetCents, payCurrency, buyerMarket, monthlyVolumeUSDCents, fxBaseRateToUSD } =
    input;
  const tier = selectTier(buyerMarket, monthlyVolumeUSDCents);
  const fixedFeeMinorUnits = currencySpec(payCurrency).fixedFeeMinorUnits;

  let netInPayCurrencyMinorUnits: number;
  if (payCurrency === ACCOUNT_CURRENCY) {
    netInPayCurrencyMinorUnits = netTargetCents;
  } else {
    if (fxBaseRateToUSD == null) {
      throw new Error(
        `fxBaseRateToUSD is required when payCurrency (${payCurrency}) differs ` +
          `from the account currency (${ACCOUNT_CURRENCY})`,
      );
    }
    const fxRate = fxRateInMinorUnits(fxBaseRateToUSD, payCurrency);
    netInPayCurrencyMinorUnits = netTargetCents / (fxRate * (1 - FX_SPREAD_RATE));
  }

  const grossMinorUnitsExact = (netInPayCurrencyMinorUnits + fixedFeeMinorUnits) / (1 - tier.rate);
  // Round up, guarding against floating-point noise landing just under
  // an exact minor-unit boundary (which would otherwise round up unnecessarily).
  const grossMinorUnits = Math.ceil(grossMinorUnitsExact - 1e-9);

  const breakdown = settle({
    grossPaidMinorUnits: grossMinorUnits,
    payCurrency,
    buyerMarket,
    monthlyVolumeUSDCents,
    fxBaseRateToUSD,
  });

  return {
    invoiceAmount: { currency: payCurrency, minorUnits: grossMinorUnits },
    breakdown,
  };
}
