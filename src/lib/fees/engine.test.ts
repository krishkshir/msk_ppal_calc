import { describe, expect, it } from "vitest";
import { quote, settle } from "./engine";
import { roundHalfUp } from "./money";
import { selectTier } from "./schedule";

describe("settle — named regression cases (T1-T3, real completed transactions)", () => {
  // CONSTITUTION.md "Observed transactions (ground truth)". All three are
  // USD->USD, so they isolate the commercial fee from the FX spread.
  it("T1: 83.00 -> 78.85", () => {
    const result = settle({
      grossPaidMinorUnits: 8300,
      payCurrency: "USD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
    });
    expect(result.commercialFee.minorUnits).toBe(415);
    expect(result.received.minorUnits).toBe(7885);
  });

  it("T2: 101.20 -> 96.21", () => {
    const result = settle({
      grossPaidMinorUnits: 10_120,
      payCurrency: "USD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
    });
    expect(result.commercialFee.minorUnits).toBe(499);
    expect(result.received.minorUnits).toBe(9621);
  });

  it("T3: 120.00 -> 114.14", () => {
    const result = settle({
      grossPaidMinorUnits: 12_000,
      payCurrency: "USD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
    });
    expect(result.commercialFee.minorUnits).toBe(586);
    expect(result.received.minorUnits).toBe(11_414);
  });

  it("flags the commercial fee as observed, with no FX line item for a same-currency payment", () => {
    const result = settle({
      grossPaidMinorUnits: 8300,
      payCurrency: "USD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
    });
    expect(result.commercialFee.confidence).toBe("observed");
    expect(result.fxConversion).toBeNull();
  });
});

describe("settle — USD structural identity", () => {
  // For a same-currency (USD) payment, grossPaid and commercialFee are
  // both already in USD, so gross - fee === net holds exactly. This is
  // NOT true across a currency conversion, where commercialFee is in
  // payCurrency but received is in USD — see
  // docs/plan-share-link-drift.html's "trap that makes the naive version
  // wrong". Kept as a test invariant (not a decode-time validator, which
  // would need to duplicate this same currency-awareness) so a future
  // engine change that breaks it is caught here.
  it("gross - fee === net for a USD settlement", () => {
    const result = settle({
      grossPaidMinorUnits: 8300,
      payCurrency: "USD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
    });
    expect(result.grossPaid.minorUnits - result.commercialFee.minorUnits).toBe(
      result.received.minorUnits,
    );
  });
});

describe("settle — guards against a negative received amount", () => {
  // A transaction smaller than the fixed fee (e.g. a $0.10 payment against
  // a $0.31 fixed fee) would otherwise silently produce a negative
  // `received` — nonsensical output a v0.2 UI could display as-is.
  it("throws rather than returning negative cents for a tiny transaction", () => {
    expect(() =>
      settle({
        grossPaidMinorUnits: 10, // $0.10 — smaller than the $0.31 fixed fee alone
        payCurrency: "USD",
        buyerMarket: "OTHER",
        monthlyVolumeUSDCents: 0,
      }),
    ).toThrow(/negative received amount/);
  });
});

describe("settle — refutation guard", () => {
  // CLAUDE.md: "Don't 'fix' this back to 4.40% by reverting to the source
  // page." These pairs were considered and refuted (docs/CONSTITUTION.md,
  // docs/plan-v0.1.html "A contradiction found while planning") — if a
  // future edit reintroduces either, this test fails loudly instead of
  // the error silently coming back.
  const T = [
    { grossPaidMinorUnits: 8300, actualFeeMinorUnits: 415 },
    { grossPaidMinorUnits: 10_120, actualFeeMinorUnits: 499 },
    { grossPaidMinorUnits: 12_000, actualFeeMinorUnits: 586 },
  ];

  function feeUnder(rate: number, fixedMinorUnits: number, grossPaidMinorUnits: number): number {
    return roundHalfUp(grossPaidMinorUnits * rate + fixedMinorUnits);
  }

  it("4.40% + $0.30 (originally-published PayPal figure) does not reproduce T1-T3", () => {
    for (const t of T) {
      expect(feeUnder(0.044, 30, t.grossPaidMinorUnits)).not.toBe(t.actualFeeMinorUnits);
    }
  });

  it("4.625% + $0.30 (individually in-band but not jointly feasible) does not reproduce T1-T3", () => {
    for (const t of T) {
      expect(feeUnder(0.04625, 30, t.grossPaidMinorUnits)).not.toBe(t.actualFeeMinorUnits);
    }
  });

  it("4.625% + $0.31 (the pair this engine encodes) reproduces T1-T3 exactly", () => {
    for (const t of T) {
      expect(feeUnder(0.04625, 31, t.grossPaidMinorUnits)).toBe(t.actualFeeMinorUnits);
    }
  });
});

describe("selectTier — tiering basis is trailing monthly volume, not transaction size", () => {
  // CONSTITUTION.md "Reconciling with Ms. K's current tool": designhill's
  // calculator tiers by the size of the single transaction typed into its
  // one input field. This asserts that bug is not reproduced here.
  it("a single $15,000 transaction with $0 trailing volume uses the lowest tier", () => {
    const tier = selectTier("OTHER", 0);
    expect(tier.rate).toBe(0.04625);
  });

  it("ten $1,500 transactions (trailing volume $15,000) use the $10k-$100k tier, not the lowest", () => {
    const tier = selectTier("OTHER", 1_500_000);
    expect(tier.rate).toBe(0.037);
  });

  it("tier boundaries are inclusive at the documented breakpoints", () => {
    expect(selectTier("OTHER", 300_000).rate).toBe(0.04625); // $3,000.00
    expect(selectTier("OTHER", 300_001).rate).toBe(0.039); // $3,000.01
    expect(selectTier("OTHER", 1_000_000).rate).toBe(0.039); // $10,000.00
    expect(selectTier("OTHER", 1_000_001).rate).toBe(0.037); // $10,000.01
    expect(selectTier("OTHER", 10_000_000).rate).toBe(0.037); // $100,000.00
    expect(selectTier("OTHER", 10_000_001).rate).toBe(0.034); // above $100,000.00
  });
});

describe("settle — effective rate falls as the amount rises", () => {
  // The signature that originally confirmed rate + fixed was the right
  // model shape (CONSTITUTION.md "Observed transactions").
  it("is monotonically decreasing across T1 < T2 < T3", () => {
    const amounts = [8300, 10_120, 12_000];
    const effectiveRates = amounts.map((grossPaidMinorUnits) => {
      const result = settle({
        grossPaidMinorUnits,
        payCurrency: "USD",
        buyerMarket: "OTHER",
        monthlyVolumeUSDCents: 0,
      });
      return result.commercialFee.minorUnits / grossPaidMinorUnits;
    });
    expect(effectiveRates[0]).toBeGreaterThan(effectiveRates[1]!);
    expect(effectiveRates[1]).toBeGreaterThan(effectiveRates[2]!);
  });
});

describe("quote — the inverse is not net / (1 - rate)", () => {
  it("differs from the naive inverse", () => {
    const netTargetCents = 10_000; // $100.00
    const { invoiceAmount } = quote({
      netTargetCents,
      payCurrency: "USD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
    });
    const naiveInverseCents = Math.round(netTargetCents / (1 - 0.04625));
    expect(invoiceAmount.minorUnits).not.toBe(naiveInverseCents);
  });

  it("rounds the invoice up so Ms. K never nets less than her target", () => {
    const netTargetCents = 10_000;
    const { invoiceAmount, breakdown } = quote({
      netTargetCents,
      payCurrency: "USD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
    });
    expect(breakdown.received.minorUnits).toBeGreaterThanOrEqual(netTargetCents);
    expect(invoiceAmount.currency).toBe("USD");
  });
});

describe("settle(quote(n)) round-trip property", () => {
  // Cent rounding on both ends makes an exact round-trip impossible, so
  // this is an honest bound (>= n, within a couple of cents), not ~= n.
  // Empirically the max overshoot across all three sweeps below is 1 cent;
  // the assertion leaves a cent of headroom rather than pinning that exactly.
  it("never nets less than the target, and overshoots by at most a couple of cents (USD)", () => {
    for (let targetCents = 100; targetCents <= 1_000_000; targetCents += 137) {
      const { invoiceAmount } = quote({
        netTargetCents: targetCents,
        payCurrency: "USD",
        buyerMarket: "OTHER",
        monthlyVolumeUSDCents: 0,
      });
      const settled = settle({
        grossPaidMinorUnits: invoiceAmount.minorUnits,
        payCurrency: "USD",
        buyerMarket: "OTHER",
        monthlyVolumeUSDCents: 0,
      });
      const delta = settled.received.minorUnits - targetCents;
      expect(delta).toBeGreaterThanOrEqual(0);
      expect(delta).toBeLessThanOrEqual(2);
    }
  });

  it("never nets less than the target, and overshoots by at most a couple of cents (CAD)", () => {
    const fxBaseRateToUSD = 0.73;
    for (let targetCents = 100; targetCents <= 500_000; targetCents += 137) {
      const { invoiceAmount } = quote({
        netTargetCents: targetCents,
        payCurrency: "CAD",
        buyerMarket: "OTHER",
        monthlyVolumeUSDCents: 0,
        fxBaseRateToUSD,
      });
      const settled = settle({
        grossPaidMinorUnits: invoiceAmount.minorUnits,
        payCurrency: "CAD",
        buyerMarket: "OTHER",
        monthlyVolumeUSDCents: 0,
        fxBaseRateToUSD,
      });
      const delta = settled.received.minorUnits - targetCents;
      expect(delta).toBeGreaterThanOrEqual(0);
      expect(delta).toBeLessThanOrEqual(2);
    }
  });

  // JPY has no minor decimal unit (minorUnitExponent 0) — this exercises
  // engine.ts's minor-unit exponent scaling (fxRateInMinorUnits) across a
  // real sweep, not just the single fixed case below.
  it("never nets less than the target, and overshoots by at most a couple of cents (JPY)", () => {
    const fxBaseRateToUSD = 0.0067;
    for (let targetCents = 100; targetCents <= 500_000; targetCents += 137) {
      const { invoiceAmount } = quote({
        netTargetCents: targetCents,
        payCurrency: "JPY",
        buyerMarket: "OTHER",
        monthlyVolumeUSDCents: 0,
        fxBaseRateToUSD,
      });
      const settled = settle({
        grossPaidMinorUnits: invoiceAmount.minorUnits,
        payCurrency: "JPY",
        buyerMarket: "OTHER",
        monthlyVolumeUSDCents: 0,
        fxBaseRateToUSD,
      });
      const delta = settled.received.minorUnits - targetCents;
      expect(delta).toBeGreaterThanOrEqual(0);
      expect(delta).toBeLessThanOrEqual(2);
    }
  });
});

describe("settle — README's Canadian scenario (NO GROUND TRUTH)", () => {
  // README.md: "A new client from Canada finds it confusing cos it
  // doesn't show him the transaction fee calculation but deducted it
  // from me." Unlike T1-T3, no real Canadian transaction has been
  // provided, so these figures are NOT validated against an observed
  // payment. They assert the engine's *documented FX-order assumption*
  // (fee first in the payment currency, then convert — see
  // docs/plan-v0.1.html "FX order of operations") stays consistent,
  // computed once via this same engine and locked in as a regression
  // guard, not sourced from a real transaction.
  //
  // v0.4 changed the CAD fixed fee from an FX-derived estimate ($0.31 /
  // 0.73 ≈ 42 CAD cents) to PayPal's published $0.30 figure looked up
  // directly (docs/plan-v0.4.html "The fixed fee stops being FX-derived")
  // — nine fewer CAD cents deducted moves these three numbers from the
  // v0.3 locks of 4667 / 2784 / 66_809 to the values below.
  it("CAD 1,000.00 at an injected base rate of 0.73 USD/CAD", () => {
    const result = settle({
      grossPaidMinorUnits: 100_000,
      payCurrency: "CAD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
      fxBaseRateToUSD: 0.73,
    });
    expect(result.commercialFee.minorUnits).toBe(4655); // CAD 46.55
    expect(result.fxConversion?.minorUnits).toBe(2784); // CAD-equivalent spread cost
    expect(result.received.minorUnits).toBe(66_818); // USD 668.18

    // Every figure in this scenario is flagged, per CONSTITUTION.md's
    // "estimates are labeled as estimates" principle.
    expect(result.commercialFee.confidence).toBe("estimated");
    expect(result.fxConversion?.confidence).toBe("estimated");
  });

  it("throws rather than silently assuming a base rate when none is provided", () => {
    expect(() =>
      settle({
        grossPaidMinorUnits: 100_000,
        payCurrency: "CAD",
        buyerMarket: "OTHER",
        monthlyVolumeUSDCents: 0,
      }),
    ).toThrow(/fxBaseRateToUSD/);
  });
});

describe("settle — JPY minor-unit scaling (self-generated regression, NOT ground truth)", () => {
  // JPY has no minor decimal unit (minorUnitExponent 0) — its "minor
  // units" ARE whole yen, unlike USD/CAD cents. fxBaseRateToUSD is
  // always expressed per major unit (USD per 1 yen), so converting
  // between yen and USD cents needs an extra 10^(2-0) scale factor
  // engine.ts applies internally (fxRateInMinorUnits) — this locks that
  // scaling in. Without it, the received amount would be off by 100x.
  it("¥10,000 at an injected base rate of 0.0067 USD/JPY", () => {
    const result = settle({
      grossPaidMinorUnits: 10_000, // ¥10,000
      payCurrency: "JPY",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
      fxBaseRateToUSD: 0.0067,
    });
    expect(result.commercialFee.minorUnits).toBe(503); // ¥503
    expect(result.fxConversion?.minorUnits).toBe(255); // USD cents
    expect(result.received.minorUnits).toBe(6108); // USD 61.08

    expect(result.commercialFee.confidence).toBe("estimated");
    expect(result.fxConversion?.confidence).toBe("estimated");
  });
});

describe("settle — optional model override (v0.5 ledger)", () => {
  // The model field lets a ledger-accepted rate/fixed-fee/spread replace
  // the static schedule.ts/currencies.ts constants without changing
  // settle()'s logic — see src/lib/fees/model.ts.
  it("uses the model's rate and fixed fee in place of the static schedule", () => {
    const result = settle({
      grossPaidMinorUnits: 8300,
      payCurrency: "USD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
      model: { rate: 0.05, fixedFeeMinorUnits: 100, confidence: "observed", asOf: "2026-09-01" },
    });
    // 8300 * 0.05 + 100 = 515, rounded — not T1's static 415.
    expect(result.commercialFee.minorUnits).toBe(515);
    expect(result.commercialFee.confidence).toBe("observed");
    expect(result.ratesAsOf).toBe("2026-09-01");
  });

  it("falls back to the static schedule for any field the model leaves unset", () => {
    // A model that only pins the rate (e.g. solved from USD observations
    // alone) must not silently invent a fixed fee or spread.
    const withModel = settle({
      grossPaidMinorUnits: 100_000,
      payCurrency: "CAD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
      fxBaseRateToUSD: 0.73,
      model: { rate: 0.04625 },
    });
    const withoutModel = settle({
      grossPaidMinorUnits: 100_000,
      payCurrency: "CAD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
      fxBaseRateToUSD: 0.73,
    });
    expect(withModel.commercialFee.minorUnits).toBe(withoutModel.commercialFee.minorUnits);
    expect(withModel.fxConversion?.minorUnits).toBe(withoutModel.fxConversion?.minorUnits);
  });

  it("keeps the commercial-fee and FX-spread confidence independent", () => {
    // A model can pin this currency's fixed fee (observed) while the FX
    // spread for it remains unvalidated — the two must not bleed into
    // each other's displayed confidence.
    const result = settle({
      grossPaidMinorUnits: 100_000,
      payCurrency: "CAD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
      fxBaseRateToUSD: 0.73,
      model: { fixedFeeMinorUnits: 30, confidence: "observed" },
    });
    expect(result.commercialFee.confidence).toBe("observed");
    expect(result.fxConversion?.confidence).toBe("estimated");
  });
});

describe("settle — manual override labeling (v0.6 fixes)", () => {
  it("an fxSpreadConfidence of 'manual' does not cite the static 4.0%/published fallback text", () => {
    const result = settle({
      grossPaidMinorUnits: 100_000,
      payCurrency: "CAD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
      fxBaseRateToUSD: 0.73,
      model: { fxSpreadRate: 0.03, fxSpreadConfidence: "manual", asOf: "2026-08-01" },
    });
    expect(result.fxConversion?.confidence).toBe("manual");
    expect(result.fxConversion?.note).not.toMatch(/4\.0%/);
    expect(result.fxConversion?.note).not.toMatch(/published/);
  });

  it("a 'manual' rate override with no matching non-USD fixed-fee override downgrades the commercial confidence", () => {
    // Only the rate half was corrected by hand; the CAD fixed fee still
    // comes from the static, unvalidated per-currency table — the
    // combined commercialFee confidence can't stay "manual".
    const result = settle({
      grossPaidMinorUnits: 100_000,
      payCurrency: "CAD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
      fxBaseRateToUSD: 0.73,
      model: { rate: 0.05, confidence: "manual", asOf: "2026-08-01" },
    });
    expect(result.commercialFee.confidence).not.toBe("manual");
    expect(result.commercialFee.confidence).toBe("estimated");
  });

  it("a manual override with no backing ledger row does not claim to be 'the accepted ledger model'", () => {
    const result = settle({
      grossPaidMinorUnits: 8300,
      payCurrency: "USD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
      model: { rate: 0.05, fixedFeeMinorUnits: 100, confidence: "manual", asOf: "2026-08-01" },
    });
    expect(result.commercialFee.note).not.toMatch(/accepted ledger model/);
  });
});

describe("schedule metadata", () => {
  it("every schedule entry carries effectiveFrom, a resolvable sourceId, and confidence", async () => {
    const { SCHEDULE } = await import("./schedule");
    const { feeSource } = await import("./sources");
    for (const entry of SCHEDULE) {
      expect(entry.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(feeSource(entry.sourceId).label.length).toBeGreaterThan(0);
      expect(["observed", "estimated", "unvalidated"]).toContain(entry.confidence);
    }
  });

  it("every currency entry carries effectiveFrom, a resolvable sourceId, and confidence", async () => {
    const { CURRENCIES } = await import("./currencies");
    const { feeSource } = await import("./sources");
    for (const entry of CURRENCIES) {
      expect(entry.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(feeSource(entry.sourceId).label.length).toBeGreaterThan(0);
      expect(["observed", "estimated", "unvalidated"]).toContain(entry.confidence);
    }
  });
});

describe("isScheduleReviewOverdue", () => {
  it("is false the day the schedule was last reviewed", async () => {
    const { SCHEDULE_LAST_REVIEWED_ON, isScheduleReviewOverdue } = await import("./schedule");
    expect(isScheduleReviewOverdue(new Date(SCHEDULE_LAST_REVIEWED_ON))).toBe(false);
  });

  it("is false right at the review interval boundary", async () => {
    const { SCHEDULE_LAST_REVIEWED_ON, REVIEW_INTERVAL_DAYS, isScheduleReviewOverdue } =
      await import("./schedule");
    const boundary = new Date(SCHEDULE_LAST_REVIEWED_ON);
    boundary.setUTCDate(boundary.getUTCDate() + REVIEW_INTERVAL_DAYS);
    expect(isScheduleReviewOverdue(boundary)).toBe(false);
  });

  it("is true one day past the review interval", async () => {
    const { SCHEDULE_LAST_REVIEWED_ON, REVIEW_INTERVAL_DAYS, isScheduleReviewOverdue } =
      await import("./schedule");
    const pastBoundary = new Date(SCHEDULE_LAST_REVIEWED_ON);
    pastBoundary.setUTCDate(pastBoundary.getUTCDate() + REVIEW_INTERVAL_DAYS + 1);
    expect(isScheduleReviewOverdue(pastBoundary)).toBe(true);
  });
});
