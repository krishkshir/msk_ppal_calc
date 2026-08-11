import { currencySpec, fxRateInMinorUnits } from "./currencies";
import type { FeeModel } from "./model";
import { roundHalfUp } from "./money";
import {
  ACCOUNT_CURRENCY,
  FX_SPREAD_RATE,
  SCHEDULE_EFFECTIVE_FROM,
  selectTier,
} from "./schedule";
import type { BuyerMarket, Breakdown, Currency, DisplayConfidence, FeeLineItem, Money } from "./types";

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
  /**
   * Pre-resolved rate/fixed-fee/spread for this specific payCurrency +
   * buyerMarket/volume tier, e.g. loaded from the ledger's active
   * fee_models row (src/lib/db, src/lib/fees/model.ts). Absent, this
   * builds the same values from schedule.ts + currencies.ts exactly as
   * before v0.5 — the fallback path if the database is ever unreachable,
   * and the reason every pre-v0.5 call site and test needs no change.
   */
  model?: FeeModel;
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
 * The static schedule's confidence describes its rate, which is only
 * ever observed in USD. For any other payCurrency, the commercial fee
 * also carries that currency's fixed fee — and in the static schedule
 * (currencies.ts), only USD's fixed fee is observed; every other
 * currency's is PayPal's published, unvalidated figure. So an "observed"
 * tier can't honestly stay "observed" once a non-USD *static* fixed fee
 * is involved — it downgrades to "estimated". A tier that's already
 * "unvalidated" stays that way; it can't get worse.
 *
 * This downgrade only applies when falling back to the static schedule
 * (fixedFeeFromModel is false) — the v0.5 ledger can observe a non-USD
 * fixed fee directly (src/lib/fees/solve.ts's solveCurrencyFixedFee), in
 * which case model.confidence already reflects that currency's real
 * evidence and must not be silently downgraded a second time.
 *
 * Anything stronger than "unvalidated" downgrades — including "manual"
 * (v0.6): a rate override with no matching non-USD fixed-fee override
 * still mixes in that static, unvalidated fixed fee, so the combined
 * figure can't keep the "Overridden" label as if all of it were
 * hand-corrected.
 */
function confidenceFor(
  tierConfidence: DisplayConfidence,
  payCurrency: Currency,
  fixedFeeFromModel: boolean,
): DisplayConfidence {
  if (payCurrency === ACCOUNT_CURRENCY || fixedFeeFromModel) {
    return tierConfidence;
  }
  return tierConfidence === "unvalidated" ? "unvalidated" : "estimated";
}

/**
 * What actually lands in Ms. K's account, given what the client paid.
 * Two deductions apply in order: PayPal's commercial transaction fee
 * (charged in the payment currency), then — only if the client paid in
 * a currency other than the account's — the currency-conversion spread
 * on the remainder. See CONSTITUTION.md "Design principles".
 */
export function settle(input: SettleInput): Breakdown {
  const {
    grossPaidMinorUnits,
    payCurrency,
    buyerMarket,
    monthlyVolumeUSDCents,
    fxBaseRateToUSD,
    model,
  } = input;
  const tier = selectTier(buyerMarket, monthlyVolumeUSDCents);
  const rate = model?.rate ?? tier.rate;
  const rateConfidence = model?.confidence ?? tier.confidence;
  const fixedFeeMinorUnits = model?.fixedFeeMinorUnits ?? currencySpec(payCurrency).fixedFeeMinorUnits;
  const spreadRate = model?.fxSpreadRate ?? FX_SPREAD_RATE;
  const asOf = model?.asOf ?? SCHEDULE_EFFECTIVE_FROM;

  const commercialFeeMinorUnits = roundHalfUp(grossPaidMinorUnits * rate + fixedFeeMinorUnits);
  const netInPayCurrencyMinorUnits = grossPaidMinorUnits - commercialFeeMinorUnits;

  if (netInPayCurrencyMinorUnits < 0) {
    throw new Error(
      `grossPaidMinorUnits (${grossPaidMinorUnits}) is smaller than the commercial fee it ` +
        `would incur (${commercialFeeMinorUnits} ${payCurrency} minor units) — settle() cannot ` +
        `return a negative received amount.`,
    );
  }

  // Checked per-field, not on `model` as a whole: a model can cover this
  // currency's fixed fee without covering (say) a different market's
  // rate, or vice versa — see model.ts's FeeModel doc comment.
  const fixedFeeFromModel = model?.fixedFeeMinorUnits != null;
  const fixedFeeIsUnvalidated = payCurrency !== ACCOUNT_CURRENCY && !fixedFeeFromModel;
  const usingLedgerRateOrFee = model?.rate != null || fixedFeeFromModel;
  const commercialFee: FeeLineItem = {
    label: `Cross-border transaction fee (${(rate * 100).toFixed(3)}% + fixed)`,
    minorUnits: commercialFeeMinorUnits,
    currency: payCurrency,
    confidence: confidenceFor(rateConfidence, payCurrency, fixedFeeFromModel),
    note: fixedFeeIsUnvalidated
      ? `${tier.note ?? ""} The ${payCurrency} fixed fee is PayPal's published figure, ` +
        `unvalidated by observation (CONSTITUTION.md open question #1).`
      : rateConfidence === "manual"
        ? `Rate and/or fixed fee include a manual override (effective ${asOf}), taking precedence ` +
          `over the ledger model and the static schedule.`
        : usingLedgerRateOrFee
          ? `Rate and fixed fee from the accepted ledger model (dated ${asOf}), not the static schedule.`
          : tier.note,
  };

  if (payCurrency === ACCOUNT_CURRENCY) {
    return {
      grossPaid: { currency: payCurrency, minorUnits: grossPaidMinorUnits },
      commercialFee,
      fxConversion: null,
      received: { currency: ACCOUNT_CURRENCY, minorUnits: netInPayCurrencyMinorUnits },
      ratesAsOf: asOf,
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
  const receivedMinorUnits = roundHalfUp(netInPayCurrencyMinorUnits * fxRate * (1 - spreadRate));
  const spreadConfidence = model?.fxSpreadConfidence ?? "estimated";
  const fxConversion: FeeLineItem = {
    label: `Currency conversion spread (${(spreadRate * 100).toFixed(1)}% above base rate)`,
    minorUnits: atBaseRateMinorUnits - receivedMinorUnits,
    currency: ACCOUNT_CURRENCY,
    confidence: spreadConfidence,
    note:
      spreadConfidence === "manual"
        ? `Currency conversion spread manually overridden (effective ${asOf}).`
        : spreadConfidence === "observed"
          ? `Currency conversion spread from the accepted ledger model (dated ${asOf}).`
          : "No observed transaction involves a currency conversion — this line " +
            "item is PayPal's published 4.0% MEA-region spread applied as-is, " +
            "not validated against a real payment.",
  };

  return {
    grossPaid: { currency: payCurrency, minorUnits: grossPaidMinorUnits },
    commercialFee,
    fxConversion,
    received: { currency: ACCOUNT_CURRENCY, minorUnits: receivedMinorUnits },
    ratesAsOf: asOf,
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
  const { netTargetCents, payCurrency, buyerMarket, monthlyVolumeUSDCents, fxBaseRateToUSD, model } =
    input;
  const tier = selectTier(buyerMarket, monthlyVolumeUSDCents);
  const rate = model?.rate ?? tier.rate;
  const fixedFeeMinorUnits = model?.fixedFeeMinorUnits ?? currencySpec(payCurrency).fixedFeeMinorUnits;
  const spreadRate = model?.fxSpreadRate ?? FX_SPREAD_RATE;

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
    netInPayCurrencyMinorUnits = netTargetCents / (fxRate * (1 - spreadRate));
  }

  const grossMinorUnitsExact = (netInPayCurrencyMinorUnits + fixedFeeMinorUnits) / (1 - rate);
  // Round up, guarding against floating-point noise landing just under
  // an exact minor-unit boundary (which would otherwise round up unnecessarily).
  const grossMinorUnits = Math.ceil(grossMinorUnitsExact - 1e-9);

  const breakdown = settle({
    grossPaidMinorUnits: grossMinorUnits,
    payCurrency,
    buyerMarket,
    monthlyVolumeUSDCents,
    fxBaseRateToUSD,
    model,
  });

  return {
    invoiceAmount: { currency: payCurrency, minorUnits: grossMinorUnits },
    breakdown,
  };
}
