import { describe, expect, it } from "vitest";
import {
  predictionSpread,
  solveCommercial,
  solveConversionSpread,
  solveCurrencyFixedFee,
  type FeeObservation,
} from "./solve";

// T1-T3, CONSTITUTION.md "Observed transactions (ground truth)".
const T1_T3: FeeObservation[] = [
  { grossPaidMinorUnits: 8300, actualFeeMinorUnits: 415 },
  { grossPaidMinorUnits: 10_120, actualFeeMinorUnits: 499 },
  { grossPaidMinorUnits: 12_000, actualFeeMinorUnits: 586 },
];

describe("solveCommercial — T1-T3 do not uniquely determine the model", () => {
  // docs/plan-v0.5.html "The finding that shapes the whole design" — six
  // fixed fees, $0.29-$0.34, each admit a rate band that reproduces all
  // three transactions exactly. This is the seeded-ledger anchor: adding
  // no new data must reproduce exactly this, not a narrower "just $0.31"
  // result.
  it("finds exactly six feasible fixed fees, $0.29 through $0.34", () => {
    const feasible = solveCommercial(T1_T3);
    expect(feasible.map((m) => m.fixedFeeMinorUnits)).toEqual([29, 30, 31, 32, 33, 34]);
  });

  it("the currently accepted model (4.625% / $0.31) is within the $0.31 band", () => {
    const feasible = solveCommercial(T1_T3);
    const at31 = feasible.find((m) => m.fixedFeeMinorUnits === 31);
    expect(at31).toBeDefined();
    expect(0.04625).toBeGreaterThanOrEqual(at31!.rateLo);
    expect(0.04625).toBeLessThan(at31!.rateHi);
  });

  it("matches the independently-verified rate bands to four decimal places", () => {
    const feasible = solveCommercial(T1_T3);
    const bands = Object.fromEntries(
      feasible.map((m) => [m.fixedFeeMinorUnits, [m.rateLo, m.rateHi]]),
    );
    expect(bands[29]![0]).toBeCloseTo(0.046446, 5);
    expect(bands[29]![1]).toBeCloseTo(0.046458, 5);
    expect(bands[34]![0]).toBeCloseTo(0.045958, 5);
    expect(bands[34]![1]).toBeCloseTo(0.045964, 5);
  });

  it("returns nothing for no observations", () => {
    expect(solveCommercial([])).toEqual([]);
  });

  it("finds a contradiction (empty feasible set) when a transaction is mistyped", () => {
    // T3's fee mistyped as 486 instead of 586 — no integer fixed fee can
    // reconcile this with T1 and T2.
    const withTypo: FeeObservation[] = [
      T1_T3[0]!,
      T1_T3[1]!,
      { grossPaidMinorUnits: 12_000, actualFeeMinorUnits: 486 },
    ];
    expect(solveCommercial(withTypo)).toEqual([]);
  });
});

describe("predictionSpread — the actual uniqueness signal", () => {
  it("agrees to the cent at the amounts already observed", () => {
    const feasible = solveCommercial(T1_T3);
    const spread = predictionSpread(feasible, [8300, 12_000]);
    for (const s of spread) {
      expect(s.maxFeeMinorUnits - s.minFeeMinorUnits).toBe(0);
    }
  });

  it("diverges by 45 cents at $1,000, growing with amount", () => {
    const feasible = solveCommercial(T1_T3);
    const spread = predictionSpread(feasible, [100_000]);
    expect(spread[0]!.maxFeeMinorUnits - spread[0]!.minFeeMinorUnits).toBe(45);
  });
});

describe("solveCurrencyFixedFee — requires a known rate and a known actual fee", () => {
  it("recovers CAD's fixed fee from a single transaction with PayPal's own fee line", () => {
    // gross CAD 100.00, rate fixed at the accepted 4.625%, PayPal's own
    // fee line reads CAD 4.93 -> fee = round(10000*0.04625 + f) = 493
    // => f in [493-0.5-462.5, 493+0.5-462.5) = [30, 31) => f = 30.
    const feasible = solveCurrencyFixedFee(
      [{ payCurrency: "CAD", grossPaidMinorUnits: 10_000, actualFeeMinorUnits: 493 }],
      0.04625,
    );
    expect(feasible).toEqual([{ payCurrency: "CAD", fixedFeeMinorUnits: 30 }]);
  });

  it("groups multiple currencies independently", () => {
    const feasible = solveCurrencyFixedFee(
      [
        { payCurrency: "CAD", grossPaidMinorUnits: 10_000, actualFeeMinorUnits: 493 },
        { payCurrency: "EUR", grossPaidMinorUnits: 10_000, actualFeeMinorUnits: 498 },
      ],
      0.04625,
    );
    const currencies = feasible.map((f) => f.payCurrency).sort();
    expect(currencies).toEqual(["CAD", "EUR"]);
  });

  it("finds nothing for a currency whose observations contradict each other at the given rate", () => {
    const feasible = solveCurrencyFixedFee(
      [
        { payCurrency: "CAD", grossPaidMinorUnits: 10_000, actualFeeMinorUnits: 493 },
        { payCurrency: "CAD", grossPaidMinorUnits: 10_000, actualFeeMinorUnits: 700 }, // wildly inconsistent
      ],
      0.04625,
    );
    expect(feasible).toEqual([]);
  });
});

describe("solveConversionSpread", () => {
  const RATE = 0.04625;

  it("recovers the currently modeled 4.0% spread from a synthetic on-model transaction", () => {
    // Synthesize a CAD 1,000.00 transaction using today's committed
    // model (fixed fee 30, spread 4.0%) exactly as engine.ts would, then
    // confirm the solver recovers a band containing 4.0%.
    const grossPaidMinorUnits = 100_000;
    const fixedFeeMinorUnits = 30;
    const commercialFeeMinorUnits = Math.floor(grossPaidMinorUnits * RATE + fixedFeeMinorUnits + 0.5);
    const net = grossPaidMinorUnits - commercialFeeMinorUnits;
    const fxReferenceRate = 0.73;
    const fxRateInMinorUnits = fxReferenceRate; // CAD and USD share exponent 2, no scaling needed
    const receivedUSDMinorUnits = Math.floor(net * fxRateInMinorUnits * (1 - 0.04) + 0.5);

    const band = solveConversionSpread([
      {
        payCurrency: "CAD",
        grossPaidMinorUnits,
        commercialFeeMinorUnits,
        receivedUSDMinorUnits,
        fxReferenceRate,
        feeIsAssumed: false,
      },
    ]);

    expect(band).not.toBeNull();
    expect(0.04).toBeGreaterThan(band!.lo);
    expect(0.04).toBeLessThanOrEqual(band!.hi);
    expect(band!.pinnedByDirectObservation).toBe(true);
  });

  it("returns null with no observations", () => {
    expect(solveConversionSpread([])).toBeNull();
  });

  it("marks a band built only from assumed fees as not pinned by direct observation", () => {
    const grossPaidMinorUnits = 100_000;
    const commercialFeeMinorUnits = 4655; // the currently modeled CAD fee, assumed rather than observed
    const net = grossPaidMinorUnits - commercialFeeMinorUnits;
    const fxReferenceRate = 0.73;
    const receivedUSDMinorUnits = Math.floor(net * fxReferenceRate * (1 - 0.04) + 0.5);

    const band = solveConversionSpread([
      {
        payCurrency: "CAD",
        grossPaidMinorUnits,
        commercialFeeMinorUnits,
        receivedUSDMinorUnits,
        fxReferenceRate,
        feeIsAssumed: true,
      },
    ]);

    expect(band?.pinnedByDirectObservation).toBe(false);
  });
});
