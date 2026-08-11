import type { Confidence, Currency } from "./currencies";
import type { BuyerMarket } from "./markets";

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
  confidence?: Confidence;
  fxSpreadConfidence?: Confidence;
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
 * Resolves the DB-accepted model into engine.ts's FeeModel shape for one
 * specific payCurrency + buyerMarket call, or undefined to fall back
 * entirely to the static schedule.ts/currencies.ts constants (no active
 * row, e.g. the database is unreachable).
 *
 * `row.rate` only ever reflects the OTHER-market $0-$3,000 tier — the
 * only tier with any ground truth (docs/CONSTITUTION.md: "her practical
 * rate is always the $0-$3,000 tier") — so it's applied only when
 * buyerMarket === "OTHER"; UAE and EEA/UK keep the static, unvalidated
 * schedule.ts rates regardless of what the ledger has accepted. The
 * fixed fee is looked up by currency, independent of market, matching
 * how currencies.ts already works. The FX spread is a single figure
 * applied uniformly whenever a payment converts currency, regardless of
 * market or which currency solved it.
 *
 * monthlyVolumeUSDCents is hardcoded to 0 here, matching every existing
 * call site in this app (src/app/page.tsx, src/app/breakdown/page.tsx) —
 * per CLAUDE.md, Ms. K's practical tier never varies by volume.
 */
export function resolveFeeModel(
  row: ActiveFeeModelRow | null,
  buyerMarket: BuyerMarket,
  payCurrency: Currency,
): FeeModel | undefined {
  if (!row) {
    return undefined;
  }

  const rate = buyerMarket === "OTHER" ? row.rate : undefined;
  const fixedFeeMinorUnits =
    payCurrency === "USD" ? row.fixedFeeMinorUnits : row.perCurrencyFixedFees[payCurrency];

  return {
    rate,
    fixedFeeMinorUnits,
    fxSpreadRate: row.fxSpreadRate,
    confidence: rate !== undefined ? row.confidence : undefined,
    fxSpreadConfidence: row.fxSpreadConfidence,
    asOf: row.asOf,
  };
}
