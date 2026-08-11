import { describe, expect, it } from "vitest";
import { ledgerRateAppliesToMarket, resolveFeeModel, type ActiveFeeModelRow } from "./model";
import type { ActiveOverrides } from "./overrides";

const LEDGER_MODEL: ActiveFeeModelRow = {
  rate: 0.04625,
  fixedFeeMinorUnits: 31,
  fxSpreadRate: 0.04,
  perCurrencyFixedFees: {},
  confidence: "observed",
  fxSpreadConfidence: "estimated",
  asOf: "2026-05-28",
};

describe("resolveFeeModel — no overrides (pre-v0.6 behavior, must be unchanged)", () => {
  it("returns undefined with no row and no overrides", () => {
    expect(resolveFeeModel(null, "OTHER", "USD")).toBeUndefined();
    expect(resolveFeeModel(null, "OTHER", "USD", [])).toBeUndefined();
  });

  it("applies the ledger row's rate only to the OTHER market", () => {
    expect(resolveFeeModel(LEDGER_MODEL, "OTHER", "USD")?.rate).toBe(0.04625);
    expect(resolveFeeModel(LEDGER_MODEL, "UAE", "USD")?.rate).toBeUndefined();
    expect(resolveFeeModel(LEDGER_MODEL, "EEA_UK", "USD")?.rate).toBeUndefined();
  });

  it("confidence mirrors the row only when the row's rate actually applies", () => {
    expect(resolveFeeModel(LEDGER_MODEL, "OTHER", "USD")?.confidence).toBe("observed");
    // UAE gets the row's USD fixed fee (currency-independent of market) but not its rate,
    // so confidence stays undefined — the static tier's own confidence takes over in engine.ts.
    expect(resolveFeeModel(LEDGER_MODEL, "UAE", "USD")?.confidence).toBeUndefined();
  });
});

describe("resolveFeeModel — with manual overrides", () => {
  it("a rate override yields confidence 'manual' and asOf from the override", () => {
    const overrides: ActiveOverrides = [
      {
        targetKey: "rate:OTHER:0",
        value: 0.05,
        effectiveFrom: "2026-07-15",
        setByEmail: "karendlima3@gmail.com",
        setAt: "2026-08-11T00:00:00Z",
        note: null,
      },
    ];
    const model = resolveFeeModel(LEDGER_MODEL, "OTHER", "USD", overrides);
    expect(model?.rate).toBe(0.05);
    expect(model?.confidence).toBe("manual");
    expect(model?.asOf).toBe("2026-07-15");
  });

  it("a UAE rate override DOES apply — unlike a fee_models row, which never does", () => {
    const overrides: ActiveOverrides = [
      {
        targetKey: "rate:UAE:0",
        value: 0.032,
        effectiveFrom: "2026-07-01",
        setByEmail: null,
        setAt: "2026-08-11T00:00:00Z",
        note: null,
      },
    ];
    expect(resolveFeeModel(null, "UAE", "USD")?.rate).toBeUndefined();
    const model = resolveFeeModel(null, "UAE", "USD", overrides);
    expect(model?.rate).toBe(0.032);
    expect(model?.confidence).toBe("manual");
  });

  it("an EEA/UK rate override also applies", () => {
    const overrides: ActiveOverrides = [
      {
        targetKey: "rate:EEA_UK:0",
        value: 0.045,
        effectiveFrom: "2026-07-01",
        setByEmail: null,
        setAt: "2026-08-11T00:00:00Z",
        note: null,
      },
    ];
    expect(resolveFeeModel(LEDGER_MODEL, "EEA_UK", "USD", overrides)?.rate).toBe(0.045);
  });

  it("a fixed-fee override wins over the ledger's per-currency figure", () => {
    const withCad: ActiveFeeModelRow = { ...LEDGER_MODEL, perCurrencyFixedFees: { CAD: 28 } };
    const overrides: ActiveOverrides = [
      {
        targetKey: "fixedFee:CAD",
        value: 33,
        effectiveFrom: "2026-08-01",
        setByEmail: null,
        setAt: "2026-08-11T00:00:00Z",
        note: null,
      },
    ];
    const model = resolveFeeModel(withCad, "OTHER", "CAD", overrides);
    expect(model?.fixedFeeMinorUnits).toBe(33);
    expect(model?.confidence).toBe("manual");
  });

  it("an fxSpread override sets fxSpreadConfidence to 'manual' independent of the commercial confidence", () => {
    const overrides: ActiveOverrides = [
      {
        targetKey: "fxSpread",
        value: 0.03,
        effectiveFrom: "2026-08-01",
        setByEmail: null,
        setAt: "2026-08-11T00:00:00Z",
        note: null,
      },
    ];
    const model = resolveFeeModel(LEDGER_MODEL, "OTHER", "EUR", overrides);
    expect(model?.fxSpreadRate).toBe(0.03);
    expect(model?.fxSpreadConfidence).toBe("manual");
    expect(model?.confidence).toBe("observed"); // unaffected — no rate/fixedFee override here
  });

  it("asOf is the later of the override's effectiveFrom and the ledger model's asOf", () => {
    const earlyOverride: ActiveOverrides = [
      {
        targetKey: "rate:OTHER:0",
        value: 0.05,
        effectiveFrom: "2026-01-01", // earlier than LEDGER_MODEL.asOf (2026-05-28)
        setByEmail: null,
        setAt: "2026-08-11T00:00:00Z",
        note: null,
      },
    ];
    expect(resolveFeeModel(LEDGER_MODEL, "OTHER", "USD", earlyOverride)?.asOf).toBe("2026-05-28");
  });

  it("with no ledger row, a fixed-fee-only override still produces a usable model", () => {
    const overrides: ActiveOverrides = [
      {
        targetKey: "fixedFee:USD",
        value: 33,
        effectiveFrom: "2026-08-01",
        setByEmail: null,
        setAt: "2026-08-11T00:00:00Z",
        note: null,
      },
    ];
    const model = resolveFeeModel(null, "OTHER", "USD", overrides);
    expect(model?.fixedFeeMinorUnits).toBe(33);
    expect(model?.rate).toBeUndefined();
    expect(model?.confidence).toBe("manual");
    expect(model?.asOf).toBe("2026-08-01");
  });
});

describe("ledgerRateAppliesToMarket", () => {
  it("is true only for OTHER", () => {
    expect(ledgerRateAppliesToMarket("OTHER")).toBe(true);
    expect(ledgerRateAppliesToMarket("UAE")).toBe(false);
    expect(ledgerRateAppliesToMarket("EEA_UK")).toBe(false);
  });
});
