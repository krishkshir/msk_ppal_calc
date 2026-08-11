import { describe, expect, it } from "vitest";
import { computeLedgerStatus, type LedgerTransaction } from "./ledger-status";

const CURRENT_MODEL = {
  rate: 0.04625,
  fixedFeeMinorUnits: 31,
  fxSpreadRate: 0.04,
  perCurrencyFixedFees: { CAD: 30 },
};

const SEED_T1_T3: LedgerTransaction[] = [
  {
    id: "T1",
    grossPaidMinorUnits: 8300,
    payCurrency: "USD",
    receivedUSDMinorUnits: 7885,
    paypalFeeMinorUnits: null,
    fxReferenceRate: null,
    excludedReason: null,
  },
  {
    id: "T2",
    grossPaidMinorUnits: 10_120,
    payCurrency: "USD",
    receivedUSDMinorUnits: 9621,
    paypalFeeMinorUnits: null,
    fxReferenceRate: null,
    excludedReason: null,
  },
  {
    id: "T3",
    grossPaidMinorUnits: 12_000,
    payCurrency: "USD",
    receivedUSDMinorUnits: 11_414,
    paypalFeeMinorUnits: null,
    fxReferenceRate: null,
    excludedReason: null,
  },
];

describe("computeLedgerStatus — seeded with T1-T3", () => {
  it("confirms the commercial model without proposing anything, from receivedUSD-derived fees", () => {
    const status = computeLedgerStatus(SEED_T1_T3, CURRENT_MODEL);
    expect(status.commercial.kind).toBe("confirmed");
    expect(status.currencyFees).toEqual([]);
    expect(status.spread).toEqual({ kind: "no-data" });
  });

  it("excludes a transaction marked excludedReason from the commercial solve", () => {
    const withExcluded: LedgerTransaction[] = [
      ...SEED_T1_T3,
      {
        id: "typo",
        grossPaidMinorUnits: 12_000,
        payCurrency: "USD",
        receivedUSDMinorUnits: 11_514, // wildly inconsistent fee if included
        paypalFeeMinorUnits: null,
        fxReferenceRate: null,
        excludedReason: "Ms. K confirmed this was a duplicate entry",
      },
    ];
    const status = computeLedgerStatus(withExcluded, CURRENT_MODEL);
    expect(status.commercial.kind).toBe("confirmed");
  });

  it("groups a non-USD transaction with a PayPal fee line into currencyFees", () => {
    const withCad: LedgerTransaction[] = [
      ...SEED_T1_T3,
      {
        id: "cad1",
        grossPaidMinorUnits: 10_000,
        payCurrency: "CAD",
        receivedUSDMinorUnits: 6600,
        paypalFeeMinorUnits: 493, // pins CAD's fixed fee at 30, per solve.test.ts
        fxReferenceRate: 0.73,
        excludedReason: null,
      },
    ];
    const status = computeLedgerStatus(withCad, CURRENT_MODEL);
    expect(status.currencyFees).toHaveLength(1);
    expect(status.currencyFees[0]!.payCurrency).toBe("CAD");
    expect(status.currencyFees[0]!.verdict.kind).toBe("confirmed");
  });
});

describe("computeLedgerStatus — no data", () => {
  it("reports a commercial contradiction (empty feasible set) with zero observations", () => {
    const status = computeLedgerStatus([], CURRENT_MODEL);
    expect(status.commercial.kind).toBe("contradiction");
    expect(status.spread).toEqual({ kind: "no-data" });
  });
});
