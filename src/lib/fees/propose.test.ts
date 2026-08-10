import { describe, expect, it } from "vitest";
import {
  decideCommercial,
  decideCurrencyFixedFee,
  decideSpread,
  type IdentifiedFeeObservation,
} from "./propose";

const T1_T3: IdentifiedFeeObservation[] = [
  { id: "T1", grossPaidMinorUnits: 8300, actualFeeMinorUnits: 415 },
  { id: "T2", grossPaidMinorUnits: 10_120, actualFeeMinorUnits: 499 },
  { id: "T3", grossPaidMinorUnits: 12_000, actualFeeMinorUnits: 586 },
];

const CURRENT_MODEL = { fixedFeeMinorUnits: 31, rate: 0.04625 };

describe("decideCommercial — seeded-solver test", () => {
  // The anchor test named in docs/plan-v0.5.html "Verification": with
  // only T1-T3 loaded, the ledger must report confirmed-not-yet-unique
  // and propose nothing — never silently pick one of the six equally
  // feasible neighbours.
  it("confirms the current model from T1-T3 alone, proposing nothing", () => {
    const verdict = decideCommercial(T1_T3, CURRENT_MODEL);
    expect(verdict.kind).toBe("confirmed");
    if (verdict.kind === "confirmed") {
      expect(verdict.confirmedBand.fixedFeeMinorUnits).toBe(31);
      expect(verdict.feasible).toHaveLength(6);
      expect(verdict.confirmedByCount).toBe(3);
    }
  });
});

describe("decideCommercial — contradiction test", () => {
  it("names the conflicting transaction and keeps the current model on a mistyped amount", () => {
    const withTypo: IdentifiedFeeObservation[] = [
      ...T1_T3,
      { id: "T4-typo", grossPaidMinorUnits: 12_000, actualFeeMinorUnits: 486 },
    ];
    const verdict = decideCommercial(withTypo, CURRENT_MODEL);
    expect(verdict.kind).toBe("contradiction");
    if (verdict.kind === "contradiction") {
      expect(verdict.conflicting.map((o) => o.id)).toContain("T4-typo");
    }
  });
});

describe("decideCommercial — resolution test", () => {
  it("proposes a new model once a large enough transaction pins the rate", () => {
    // Synthesize what a real $2,000 transaction would look like under a
    // *different* true model — the $0.29 neighbour, at the midpoint of
    // its own T1-T3-feasible band — which also fits T1-T3 (it's one of
    // the six feasible neighbours). A transaction this size collapses the
    // band down to that one model alone.
    const TRUE_RATE = 0.04645205823293173;
    const TRUE_FIXED = 29;
    const bigGross = 200_000; // $2,000.00
    const bigFee = Math.floor(bigGross * TRUE_RATE + TRUE_FIXED + 0.5);
    const observations: IdentifiedFeeObservation[] = [
      ...T1_T3,
      { id: "T4", grossPaidMinorUnits: bigGross, actualFeeMinorUnits: bigFee },
    ];

    const verdict = decideCommercial(observations, CURRENT_MODEL);
    expect(verdict.kind).toBe("propose");
    if (verdict.kind === "propose") {
      expect(verdict.proposedModel.fixedFeeMinorUnits).toBe(TRUE_FIXED);
    }
  });
});

describe("decideCommercial — no observations", () => {
  it("is a contradiction (empty feasible set) rather than a false confirmation", () => {
    const verdict = decideCommercial([], CURRENT_MODEL);
    expect(verdict.kind).toBe("contradiction");
  });
});

describe("decideCurrencyFixedFee", () => {
  it("reports no-data with nothing recorded for that currency", () => {
    expect(decideCurrencyFixedFee([], 0.04625, 30)).toEqual({ kind: "no-data" });
  });

  it("confirms CAD's published $0.30 fee when a PayPal-fee-line transaction fits it", () => {
    const feeAt30 = Math.floor(10_000 * 0.04625 + 30 + 0.5);
    const verdict = decideCurrencyFixedFee(
      [{ payCurrency: "CAD", grossPaidMinorUnits: 10_000, actualFeeMinorUnits: feeAt30 }],
      0.04625,
      30,
    );
    expect(verdict.kind).toBe("confirmed");
  });

  it("proposes a change when the observed fee rules out the current figure", () => {
    const feeAt55 = Math.floor(10_000 * 0.04625 + 55 + 0.5);
    const verdict = decideCurrencyFixedFee(
      [{ payCurrency: "CAD", grossPaidMinorUnits: 10_000, actualFeeMinorUnits: feeAt55 }],
      0.04625,
      30,
    );
    expect(verdict.kind).toBe("propose");
  });
});

describe("decideSpread", () => {
  it("reports no-data with nothing recorded", () => {
    expect(decideSpread([], 0.04)).toEqual({ kind: "no-data" });
  });

  it("confirms the current 4.0% spread from an on-model synthetic transaction", () => {
    const grossPaidMinorUnits = 100_000;
    const commercialFeeMinorUnits = Math.floor(grossPaidMinorUnits * 0.04625 + 30 + 0.5);
    const net = grossPaidMinorUnits - commercialFeeMinorUnits;
    const fxReferenceRate = 0.73;
    const receivedUSDMinorUnits = Math.floor(net * fxReferenceRate * (1 - 0.04) + 0.5);

    const verdict = decideSpread(
      [
        {
          payCurrency: "CAD",
          grossPaidMinorUnits,
          commercialFeeMinorUnits,
          receivedUSDMinorUnits,
          fxReferenceRate,
          feeIsAssumed: false,
        },
      ],
      0.04,
    );
    expect(verdict.kind).toBe("confirmed");
  });

  it("does not propose a spread change built only on an assumed fee", () => {
    const grossPaidMinorUnits = 100_000;
    const commercialFeeMinorUnits = 4700; // deliberately off the modeled fee, and unconfirmed
    const net = grossPaidMinorUnits - commercialFeeMinorUnits;
    const fxReferenceRate = 0.73;
    const receivedUSDMinorUnits = Math.floor(net * fxReferenceRate * (1 - 0.065) + 0.5);

    const verdict = decideSpread(
      [
        {
          payCurrency: "CAD",
          grossPaidMinorUnits,
          commercialFeeMinorUnits,
          receivedUSDMinorUnits,
          fxReferenceRate,
          feeIsAssumed: true,
        },
      ],
      0.04,
    );
    expect(verdict.kind).toBe("unresolved");
    if (verdict.kind === "unresolved") {
      expect(verdict.reason).toBe("not-pinned");
    }
  });
});
