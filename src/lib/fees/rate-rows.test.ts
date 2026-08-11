import { describe, expect, it } from "vitest";
import { CURRENCIES } from "./currencies";
import type { ActiveFeeModelRow } from "./model";
import { targetKey, type ActiveOverrides } from "./overrides";
import { buildRateRows } from "./rate-rows";
import { SCHEDULE } from "./schedule";

const LEDGER_MODEL: ActiveFeeModelRow = {
  rate: 0.046,
  fixedFeeMinorUnits: 32,
  fxSpreadRate: 0.038,
  perCurrencyFixedFees: { CAD: 28 },
  confidence: "observed",
  fxSpreadConfidence: "estimated",
  asOf: "2026-06-01",
};

describe("buildRateRows — coverage guard", () => {
  it("produces exactly one row per SCHEDULE entry, one per CURRENCIES entry, and one for the FX spread", () => {
    const rows = buildRateRows(null, []);
    expect(rows.length).toBe(SCHEDULE.length + CURRENCIES.length + 1);
  });

  it("every row resolves a source with a non-empty label", () => {
    const rows = buildRateRows(LEDGER_MODEL, []);
    for (const row of rows) {
      expect(row.source.label.length).toBeGreaterThan(0);
      expect(["published", "third-party", "derived", "manual"]).toContain(row.source.kind);
    }
  });

  it("marks only the three higher OTHER-market volume tiers as not applicable", () => {
    const rows = buildRateRows(null, []);
    const inapplicable = rows.filter((r) => !r.applicable);
    expect(inapplicable.length).toBe(3);
    expect(inapplicable.every((r) => r.target.kind === "rate" && r.target.buyerMarket === "OTHER")).toBe(true);
    expect(inapplicable.every((r) => r.target.kind === "rate" && r.target.minMonthlyVolumeUSDCents > 0)).toBe(true);
  });

  it("marks the $0-$3,000 OTHER tier and the UAE/EEA_UK tiers as applicable", () => {
    const rows = buildRateRows(null, []);
    const applicable = rows.filter(
      (r) => r.target.kind === "rate" && r.target.minMonthlyVolumeUSDCents === 0,
    );
    expect(applicable.length).toBe(3); // OTHER:0, UAE:0, EEA_UK:0
    expect(applicable.every((r) => r.applicable)).toBe(true);
  });

  it("commercial-rate formValue round-trips every SCHEDULE rate exactly, with no IEEE-754 noise", () => {
    const rows = buildRateRows(null, []);
    for (const entry of SCHEDULE) {
      const row = rows.find(
        (r) =>
          r.target.kind === "rate" &&
          r.target.buyerMarket === entry.buyerMarket &&
          r.target.minMonthlyVolumeUSDCents === entry.minMonthlyVolumeUSDCents,
      )!;
      expect(Number(row.formValue) / 100).toBeCloseTo(entry.rate, 10);
      expect(row.formValue).not.toMatch(/\.\d{5,}/);
    }
  });
});

describe("buildRateRows — precedence: static -> ledger model -> override", () => {
  it("commercial rate: static table wins with no ledger model and no override", () => {
    const rows = buildRateRows(null, []);
    const row = rows.find((r) => r.targetKey === "rate:OTHER:0")!;
    expect(row.display).toBe("4.625%");
    expect(row.source.kind).toBe("derived"); // observedTransactions
    expect(row.baseline).toBeUndefined();
  });

  it("commercial rate: ledger model wins over the static table for the OTHER market", () => {
    const rows = buildRateRows(LEDGER_MODEL, []);
    const row = rows.find((r) => r.targetKey === "rate:OTHER:0")!;
    expect(row.display).toBe("4.600%");
    expect(row.effectiveDate).toBe("2026-06-01");
  });

  it("commercial rate: the ledger model never applies to UAE or EEA/UK", () => {
    const rows = buildRateRows(LEDGER_MODEL, []);
    const uae = rows.find((r) => r.targetKey === "rate:UAE:0")!;
    const eeaUk = rows.find((r) => r.targetKey === "rate:EEA_UK:0")!;
    expect(uae.display).toBe("3.400%");
    expect(eeaUk.display).toBe("4.690%");
  });

  it("commercial rate: an override beats both the ledger model and the static table, and masks the baseline", () => {
    const overrides: ActiveOverrides = [
      {
        targetKey: "rate:OTHER:0",
        value: 0.05,
        effectiveFrom: "2026-07-01",
        setByEmail: "karendlima3@gmail.com",
        setAt: "2026-08-11T00:00:00Z",
        note: "PayPal raised the rate.",
      },
    ];
    const rows = buildRateRows(LEDGER_MODEL, overrides);
    const row = rows.find((r) => r.targetKey === "rate:OTHER:0")!;
    expect(row.display).toBe("5.000%");
    expect(row.formValue).toBe("5"); // prefills the edit form as a percentage, not a fraction
    expect(row.source.kind).toBe("manual");
    expect(row.setBy).toBe("karendlima3@gmail.com");
    expect(row.baseline?.display).toBe("4.600%"); // the masked ledger-model figure
  });

  it("a cleared override (absent from ActiveOverrides) falls back to the ledger model", () => {
    const rowsWithOverride = buildRateRows(LEDGER_MODEL, [
      {
        targetKey: "fxSpread",
        value: 0.02,
        effectiveFrom: "2026-07-01",
        setByEmail: null,
        setAt: "2026-08-01T00:00:00Z",
        note: null,
      },
    ]);
    expect(rowsWithOverride.find((r) => r.targetKey === "fxSpread")!.display).toBe("2.000%");

    const rowsAfterClear = buildRateRows(LEDGER_MODEL, []); // getActiveOverrides omits cleared rows entirely
    const row = rowsAfterClear.find((r) => r.targetKey === "fxSpread")!;
    expect(row.display).toBe("3.800%"); // back to the ledger model
    expect(row.baseline).toBeUndefined();
  });

  it("fixed fee: per-currency ledger override applies only to the currency it names", () => {
    const rows = buildRateRows(LEDGER_MODEL, []);
    const cad = rows.find((r) => r.targetKey === targetKey({ kind: "fixedFee", currency: "CAD" }))!;
    const eur = rows.find((r) => r.targetKey === targetKey({ kind: "fixedFee", currency: "EUR" }))!;
    expect(cad.display).toBe("CAD 0.28");
    expect(cad.source.kind).toBe("derived");
    expect(eur.display).toBe("EUR 0.35"); // untouched by the ledger model, stays on the static table
    expect(eur.source.kind).toBe("published");
  });

  it("fixed fee: USD fixed fee comes from the ledger's fixedFeeMinorUnits, not perCurrencyFixedFees", () => {
    const rows = buildRateRows(LEDGER_MODEL, []);
    const usd = rows.find((r) => r.targetKey === targetKey({ kind: "fixedFee", currency: "USD" }))!;
    expect(usd.display).toBe("USD 0.32");
  });

  it("fixed fee: a JPY override is stored and displayed in whole yen, never scaled", () => {
    const overrides: ActiveOverrides = [
      {
        targetKey: "fixedFee:JPY",
        value: 45,
        effectiveFrom: "2026-08-01",
        setByEmail: "shrikantkshirsagar29@gmail.com",
        setAt: "2026-08-11T00:00:00Z",
        note: null,
      },
    ];
    const row = buildRateRows(null, overrides).find((r) => r.targetKey === "fixedFee:JPY")!;
    expect(row.display).toBe("JPY 45");
    expect(row.formValue).toBe("45"); // not "0.45" or "4500" — JPY has no minor-unit exponent
  });

  it("fixed fee: a USD form value is prefilled in dollars, not cents", () => {
    const row = buildRateRows(null, []).find((r) => r.targetKey === "fixedFee:USD")!;
    expect(row.display).toBe("USD 0.31");
    expect(row.formValue).toBe("0.31");
  });
});
