import type { Currency } from "./currencies";
import {
  decideCommercial,
  decideCurrencyFixedFee,
  decideSpread,
  type CommercialVerdict,
  type CurrencyFeeVerdict,
  type IdentifiedFeeObservation,
  type SpreadVerdict,
} from "./propose";
import type { ConversionObservation, CurrencyFeeObservation } from "./solve";

export interface LedgerTransaction {
  id: string;
  grossPaidMinorUnits: number;
  payCurrency: Currency;
  receivedUSDMinorUnits: number;
  paypalFeeMinorUnits: number | null;
  fxReferenceRate: number | null;
  excludedReason: string | null;
}

export interface CurrentModel {
  rate: number;
  fixedFeeMinorUnits: number;
  fxSpreadRate: number;
  perCurrencyFixedFees: Partial<Record<Currency, number>>;
}

export interface LedgerStatus {
  commercial: CommercialVerdict;
  /** One entry per non-USD currency with at least one usable observation. */
  currencyFees: Array<{ payCurrency: Currency; verdict: CurrencyFeeVerdict }>;
  spread: SpreadVerdict;
}

/**
 * Turns the raw ledger (transactions + the currently accepted model) into
 * the three independent verdicts the status panel renders — see
 * docs/plan-v0.5.html "The ledger status panel". Kept out of solve.ts/
 * propose.ts (which stay pure, DB-agnostic) and out of the UI layer
 * (which shouldn't re-derive this filtering logic) — this is the one
 * place that decides which transactions feed which question.
 */
export function computeLedgerStatus(
  transactions: readonly LedgerTransaction[],
  current: CurrentModel,
): LedgerStatus {
  const usable = transactions.filter((t) => t.excludedReason == null);

  // USD transactions with no conversion isolate the commercial fee
  // exactly (receivedUSD IS the net) — the same method T1-T3 use
  // (docs/CONSTITUTION.md "Observed transactions").
  const commercialObservations: IdentifiedFeeObservation[] = usable
    .filter((t) => t.payCurrency === "USD")
    .map((t) => ({
      id: t.id,
      grossPaidMinorUnits: t.grossPaidMinorUnits,
      actualFeeMinorUnits: t.grossPaidMinorUnits - t.receivedUSDMinorUnits,
    }));

  const commercial = decideCommercial(commercialObservations, {
    rate: current.rate,
    fixedFeeMinorUnits: current.fixedFeeMinorUnits,
  });

  // Only a transaction where PayPal's own fee line was read off directly
  // (paypalFeeMinorUnits) pins a non-USD currency's fixed fee — see
  // solve.ts's solveCurrencyFixedFee doc comment.
  const byCurrency = new Map<Currency, CurrencyFeeObservation[]>();
  for (const t of usable) {
    if (t.payCurrency === "USD" || t.paypalFeeMinorUnits == null) continue;
    const list = byCurrency.get(t.payCurrency) ?? [];
    list.push({
      payCurrency: t.payCurrency,
      grossPaidMinorUnits: t.grossPaidMinorUnits,
      actualFeeMinorUnits: t.paypalFeeMinorUnits,
    });
    byCurrency.set(t.payCurrency, list);
  }
  const currencyFees = [...byCurrency.entries()].map(([payCurrency, observations]) => ({
    payCurrency,
    verdict: decideCurrencyFixedFee(
      observations,
      current.rate,
      current.perCurrencyFixedFees[payCurrency] ?? current.fixedFeeMinorUnits,
    ),
  }));

  // Every non-USD transaction with a cached FX reference rate can
  // constrain the spread — using PayPal's own fee line when present
  // (feeIsAssumed: false, pins the band tightly) and the currently
  // modeled fixed fee otherwise (feeIsAssumed: true, only a working
  // prior — see solve.ts's ConversionObservation doc comment).
  const spreadObservations: ConversionObservation[] = usable
    .filter((t): t is typeof t & { fxReferenceRate: number } => t.payCurrency !== "USD" && t.fxReferenceRate != null)
    .map((t) => {
      const feeIsAssumed = t.paypalFeeMinorUnits == null;
      const commercialFeeMinorUnits =
        t.paypalFeeMinorUnits ?? current.perCurrencyFixedFees[t.payCurrency] ?? current.fixedFeeMinorUnits;
      return {
        payCurrency: t.payCurrency,
        grossPaidMinorUnits: t.grossPaidMinorUnits,
        commercialFeeMinorUnits:
          feeIsAssumed
            ? Math.round(t.grossPaidMinorUnits * current.rate + commercialFeeMinorUnits)
            : commercialFeeMinorUnits,
        receivedUSDMinorUnits: t.receivedUSDMinorUnits,
        fxReferenceRate: t.fxReferenceRate,
        feeIsAssumed,
      };
    });

  const spread = decideSpread(spreadObservations, current.fxSpreadRate);

  return { commercial, currencyFees, spread };
}
