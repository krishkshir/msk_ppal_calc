import { describe, expect, it } from "vitest";
import { quote, settle } from "./engine";
import { selectTier } from "./schedule";

describe("settle — named regression cases (T1-T3, real completed transactions)", () => {
  // CONSTITUTION.md "Observed transactions (ground truth)". All three are
  // USD->USD, so they isolate the commercial fee from the FX spread.
  it("T1: 83.00 -> 78.85", () => {
    const result = settle({
      grossPaidCents: 8300,
      payCurrency: "USD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
    });
    expect(result.commercialFee.cents).toBe(415);
    expect(result.received.cents).toBe(7885);
  });

  it("T2: 101.20 -> 96.21", () => {
    const result = settle({
      grossPaidCents: 10_120,
      payCurrency: "USD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
    });
    expect(result.commercialFee.cents).toBe(499);
    expect(result.received.cents).toBe(9621);
  });

  it("T3: 120.00 -> 114.14", () => {
    const result = settle({
      grossPaidCents: 12_000,
      payCurrency: "USD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
    });
    expect(result.commercialFee.cents).toBe(586);
    expect(result.received.cents).toBe(11_414);
  });

  it("flags the commercial fee as observed, with no FX line item for a same-currency payment", () => {
    const result = settle({
      grossPaidCents: 8300,
      payCurrency: "USD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
    });
    expect(result.commercialFee.confidence).toBe("observed");
    expect(result.fxConversion).toBeNull();
  });
});

describe("settle — refutation guard", () => {
  // CLAUDE.md: "Don't 'fix' this back to 4.40% by reverting to the source
  // page." These pairs were considered and refuted (docs/CONSTITUTION.md,
  // docs/plan-v0.1.html "A contradiction found while planning") — if a
  // future edit reintroduces either, this test fails loudly instead of
  // the error silently coming back.
  const T = [
    { grossPaidCents: 8300, actualFeeCents: 415 },
    { grossPaidCents: 10_120, actualFeeCents: 499 },
    { grossPaidCents: 12_000, actualFeeCents: 586 },
  ];

  function feeUnder(rate: number, fixedCents: number, grossPaidCents: number): number {
    return Math.floor(grossPaidCents * rate + fixedCents + 0.5);
  }

  it("4.40% + $0.30 (originally-published PayPal figure) does not reproduce T1-T3", () => {
    for (const t of T) {
      expect(feeUnder(0.044, 30, t.grossPaidCents)).not.toBe(t.actualFeeCents);
    }
  });

  it("4.625% + $0.30 (individually in-band but not jointly feasible) does not reproduce T1-T3", () => {
    for (const t of T) {
      expect(feeUnder(0.04625, 30, t.grossPaidCents)).not.toBe(t.actualFeeCents);
    }
  });

  it("4.625% + $0.31 (the pair this engine encodes) reproduces T1-T3 exactly", () => {
    for (const t of T) {
      expect(feeUnder(0.04625, 31, t.grossPaidCents)).toBe(t.actualFeeCents);
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
    const effectiveRates = amounts.map((grossPaidCents) => {
      const result = settle({
        grossPaidCents,
        payCurrency: "USD",
        buyerMarket: "OTHER",
        monthlyVolumeUSDCents: 0,
      });
      return result.commercialFee.cents / grossPaidCents;
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
    expect(invoiceAmount.cents).not.toBe(naiveInverseCents);
  });

  it("rounds the invoice up so Ms. K never nets less than her target", () => {
    const netTargetCents = 10_000;
    const { invoiceAmount, breakdown } = quote({
      netTargetCents,
      payCurrency: "USD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
    });
    expect(breakdown.received.cents).toBeGreaterThanOrEqual(netTargetCents);
    expect(invoiceAmount.currency).toBe("USD");
  });
});

describe("settle(quote(n)) round-trip property", () => {
  // Cent rounding on both ends makes an exact round-trip impossible, so
  // this is an honest bound (>= n, within a couple of cents), not ~= n.
  // Empirically the max overshoot across both sweeps below is 1 cent;
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
        grossPaidCents: invoiceAmount.cents,
        payCurrency: "USD",
        buyerMarket: "OTHER",
        monthlyVolumeUSDCents: 0,
      });
      const delta = settled.received.cents - targetCents;
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
        grossPaidCents: invoiceAmount.cents,
        payCurrency: "CAD",
        buyerMarket: "OTHER",
        monthlyVolumeUSDCents: 0,
        fxBaseRateToUSD,
      });
      const delta = settled.received.cents - targetCents;
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
  it("CAD 1,000.00 at an injected base rate of 0.73 USD/CAD", () => {
    const result = settle({
      grossPaidCents: 100_000,
      payCurrency: "CAD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
      fxBaseRateToUSD: 0.73,
    });
    expect(result.commercialFee.cents).toBe(4667); // CAD 46.67
    expect(result.fxConversion?.cents).toBe(2784); // CAD-equivalent spread cost
    expect(result.received.cents).toBe(66_809); // USD 668.09

    // Every figure in this scenario is flagged, per CONSTITUTION.md's
    // "estimates are labeled as estimates" principle.
    expect(result.commercialFee.confidence).toBe("estimated");
    expect(result.fxConversion?.confidence).toBe("estimated");
  });

  it("throws rather than silently assuming a base rate when none is provided", () => {
    expect(() =>
      settle({
        grossPaidCents: 100_000,
        payCurrency: "CAD",
        buyerMarket: "OTHER",
        monthlyVolumeUSDCents: 0,
      }),
    ).toThrow(/fxBaseRateToUSD/);
  });
});

describe("schedule metadata", () => {
  it("every schedule entry carries effectiveFrom, sourceUrl, and confidence", async () => {
    const { SCHEDULE } = await import("./schedule");
    for (const entry of SCHEDULE) {
      expect(entry.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.sourceUrl.length).toBeGreaterThan(0);
      expect(["observed", "estimated", "unvalidated"]).toContain(entry.confidence);
    }
  });
});
