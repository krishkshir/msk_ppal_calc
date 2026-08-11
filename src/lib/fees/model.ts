import type { Confidence, Currency, DisplayConfidence } from "./currencies";
import type { BuyerMarket } from "./markets";
import { findOverride, type ActiveOverrides, type OverrideTarget } from "./overrides";
import { selectTier } from "./schedule";

/**
 * A partial rate/fixed-fee/spread override for one specific payCurrency +
 * buyerMarket call, as accepted into the ledger (docs/plan-v0.5.html).
 * Every field is independently optional and independently falls back in
 * engine.ts (`model?.rate ?? tier.rate`, etc.) — resolveFeeModel below
 * only ever sets the fields this call actually has ledger evidence for,
 * leaving the rest undefined so engine.ts's normal static fallback
 * applies to them unchanged.
 *
 * Two separate confidence fields, not one: an earlier version of this
 * type used a single `confidence` for the whole bundle, but that broke
 * the moment a currency's fixed fee was solved while its FX spread
 * wasn't (or vice versa) — a UAE client paying in USD would have shown
 * the FX spread as "observed" purely because the *unrelated* commercial
 * fee had been. `confidence` describes the commercial rate/fixed fee;
 * `fxSpreadConfidence` describes the spread. They move independently
 * because the evidence for them does.
 */
export interface FeeModel {
  rate?: number;
  fixedFeeMinorUnits?: number;
  fxSpreadRate?: number;
  confidence?: DisplayConfidence;
  fxSpreadConfidence?: DisplayConfidence;
  /** Version identifier for this model, e.g. its acceptance date — becomes Breakdown.ratesAsOf. */
  asOf?: string;
}

/** The shape src/lib/db's query layer maps a fee_models row into. */
export interface ActiveFeeModelRow {
  rate: number;
  fixedFeeMinorUnits: number;
  fxSpreadRate: number;
  perCurrencyFixedFees: Partial<Record<Currency, number>>;
  confidence: Confidence;
  fxSpreadConfidence: Confidence;
  asOf: string;
}

/**
 * A ledger-accepted rate only ever reflects the OTHER-market ground
 * truth (docs/CONSTITUTION.md: "her practical rate is always the
 * $0-$3,000 tier") — UAE and EEA/UK keep the static, unvalidated
 * schedule.ts rates regardless of what the ledger has accepted. Shared
 * with src/lib/fees/rate-rows.ts so the rates table shows exactly the
 * same precedence the engine actually applies.
 */
export function ledgerRateAppliesToMarket(buyerMarket: BuyerMarket): boolean {
  return buyerMarket === "OTHER";
}

function laterDate(a: string | undefined, b: string | undefined): string | undefined {
  if (a == null) return b;
  if (b == null) return a;
  return a > b ? a : b;
}

/**
 * Resolves the DB-accepted model plus any manual overrides into
 * engine.ts's FeeModel shape for one specific payCurrency + buyerMarket
 * call, or undefined only when neither an active ledger model nor any
 * relevant override exists — the fall-back-entirely-to-static-constants
 * signal (no database row, no override, e.g. the database is
 * unreachable).
 *
 * Precedence, highest wins: a manual override (docs/plan-v0.6.html)
 * beats the ledger-accepted model, which beats engine.ts's own static
 * schedule.ts/currencies.ts fallback. `overrides` defaults to `[]` so
 * every pre-v0.6 call site (and every pre-v0.6 test) keeps behaving
 * exactly as before.
 *
 * The fixed fee is looked up by currency, independent of market,
 * matching how currencies.ts already works. The FX spread is a single
 * figure applied uniformly whenever a payment converts currency,
 * regardless of market or which currency solved it.
 *
 * monthlyVolumeUSDCents is hardcoded to 0 here, matching every existing
 * call site in this app (src/app/page.tsx, src/app/breakdown/page.tsx) —
 * per CLAUDE.md, Ms. K's practical tier never varies by volume. The rate
 * override's target key uses that same tier (selectTier(buyerMarket, 0)),
 * so it's scoped to the tier Ms. K is actually ever quoted against.
 */
export function resolveFeeModel(
  row: ActiveFeeModelRow | null,
  buyerMarket: BuyerMarket,
  payCurrency: Currency,
  overrides: ActiveOverrides = [],
): FeeModel | undefined {
  const rateTier = selectTier(buyerMarket, 0);
  const rateTarget: OverrideTarget = {
    kind: "rate",
    buyerMarket,
    minMonthlyVolumeUSDCents: rateTier.minMonthlyVolumeUSDCents,
  };
  const fixedFeeTarget: OverrideTarget = { kind: "fixedFee", currency: payCurrency };
  const fxSpreadTarget: OverrideTarget = { kind: "fxSpread" };

  const rateOverride = findOverride(overrides, rateTarget);
  const fixedFeeOverride = findOverride(overrides, fixedFeeTarget);
  const fxSpreadOverride = findOverride(overrides, fxSpreadTarget);

  const ledgerRate = row && ledgerRateAppliesToMarket(buyerMarket) ? row.rate : undefined;
  const ledgerFixedFeeMinorUnits = row
    ? payCurrency === "USD"
      ? row.fixedFeeMinorUnits
      : row.perCurrencyFixedFees[payCurrency]
    : undefined;

  const rate = rateOverride?.value ?? ledgerRate;
  const fixedFeeMinorUnits = fixedFeeOverride?.value ?? ledgerFixedFeeMinorUnits;
  const fxSpreadRate = fxSpreadOverride?.value ?? row?.fxSpreadRate;

  if (rate === undefined && fixedFeeMinorUnits === undefined && fxSpreadRate === undefined) {
    return undefined;
  }

  // A manual override on either the rate or this currency's fixed fee
  // makes the whole commercial-fee confidence "manual" — engine.ts's
  // commercialFee badge is a single figure covering both, and leaving it
  // at whatever the static/ledger confidence would have been risks
  // understating (an "unvalidated" badge on a figure someone just
  // corrected) or overstating (a stale "observed" badge) what's actually
  // known now.
  //
  // Exception: a fixed-fee-only override (no rate override, no ledger
  // rate) leaves the rate half of the commercial fee resolved from the
  // static schedule in engine.ts. If that static tier's rate is itself
  // "unvalidated" (UAE, EEA_UK), claiming "manual" here would suppress
  // the unvalidated marker on a rate nobody actually corrected.
  const rateStillStaticUnvalidated =
    !rateOverride && ledgerRate === undefined && rateTier.confidence === "unvalidated";
  const confidence: DisplayConfidence | undefined =
    rateOverride || fixedFeeOverride
      ? rateStillStaticUnvalidated
        ? "unvalidated"
        : "manual"
      : rate !== undefined && row
        ? row.confidence
        : undefined;
  const fxSpreadConfidence: DisplayConfidence | undefined = fxSpreadOverride
    ? "manual"
    : row?.fxSpreadConfidence;

  const asOf = [
    rateOverride?.effectiveFrom,
    fixedFeeOverride?.effectiveFrom,
    fxSpreadOverride?.effectiveFrom,
  ].reduce<string | undefined>(laterDate, row?.asOf);

  return { rate, fixedFeeMinorUnits, fxSpreadRate, confidence, fxSpreadConfidence, asOf };
}
