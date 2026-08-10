import { describe, expect, it } from "vitest";
import { settle } from "../fees/engine";
import { applyFrozenFigures, breakdownFromFrozenOnly, hasFrozenDrift } from "./drift";

describe("hasFrozenDrift", () => {
  it("is false when the recomputed figures match the frozen ones exactly", () => {
    const breakdown = settle({
      grossPaidMinorUnits: 10_000,
      payCurrency: "USD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
    });
    expect(
      hasFrozenDrift(breakdown, {
        feeMinorUnits: breakdown.commercialFee.minorUnits,
        netMinorUnits: breakdown.received.minorUnits,
      }),
    ).toBe(false);
  });

  it("regression: a pre-v0.4 CAD link's frozen fee/net (from the old FX-derived fixed fee) drifts from a v0.4 recomputation", () => {
    // The exact scenario the code-review finding was built on: CAD
    // 1,000.00 at 0.73 USD/CAD. Pre-v0.4, the CAD fixed fee was derived
    // from the FX rate (~42 CAD cents); a link created then would have
    // frozen the v0.3-era locks of commercialFee 4667 / received 66_809
    // (see engine.test.ts's Canadian-scenario test history). Recomputing
    // those same inputs under the current engine — CAD's fixed fee now a
    // flat, published 30-cent lookup — yields different figures with no
    // change to SCHEDULE_EFFECTIVE_FROM at all.
    const recomputed = settle({
      grossPaidMinorUnits: 100_000,
      payCurrency: "CAD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
      fxBaseRateToUSD: 0.73,
    });
    expect(recomputed.commercialFee.minorUnits).toBe(4655);
    expect(recomputed.received.minorUnits).toBe(66_818);

    const frozenFromOldLink = {
      feeMinorUnits: 4667,
      netMinorUnits: 66_809,
      spreadMinorUnits: recomputed.fxConversion?.minorUnits,
    };
    expect(hasFrozenDrift(recomputed, frozenFromOldLink)).toBe(true);
  });

  it("is true when only the spread differs (USD/non-USD null-vs-undefined doesn't false-positive)", () => {
    const breakdown = settle({
      grossPaidMinorUnits: 10_000,
      payCurrency: "USD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
    });
    // A USD breakdown has fxConversion: null and no spreadMinorUnits —
    // this must NOT read as drift on its own.
    expect(
      hasFrozenDrift(breakdown, {
        feeMinorUnits: breakdown.commercialFee.minorUnits,
        netMinorUnits: breakdown.received.minorUnits,
      }),
    ).toBe(false);
  });
});

describe("applyFrozenFigures", () => {
  it("overrides the fee, spread, received amounts, and ratesAsOf with the frozen values", () => {
    const recomputed = settle({
      grossPaidMinorUnits: 100_000,
      payCurrency: "CAD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
      fxBaseRateToUSD: 0.73,
    });
    const frozen = { feeMinorUnits: 4667, netMinorUnits: 66_809, spreadMinorUnits: 2784 };
    const shown = applyFrozenFigures(recomputed, frozen, "2026-01-01");

    expect(shown.commercialFee.minorUnits).toBe(4667);
    expect(shown.received.minorUnits).toBe(66_809);
    expect(shown.fxConversion?.minorUnits).toBe(2784);
    expect(shown.ratesAsOf).toBe("2026-01-01");
    // Untouched fields carry over from the recomputed breakdown.
    expect(shown.grossPaid).toEqual(recomputed.grossPaid);
    expect(shown.commercialFee.currency).toBe(recomputed.commercialFee.currency);
  });

  it("leaves fxConversion null for a USD breakdown even if frozen carried no spread", () => {
    const recomputed = settle({
      grossPaidMinorUnits: 10_000,
      payCurrency: "USD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
    });
    const shown = applyFrozenFigures(
      recomputed,
      { feeMinorUnits: 480, netMinorUnits: 9_520 },
      "2026-01-01",
    );
    expect(shown.fxConversion).toBeNull();
  });
});

describe("breakdownFromFrozenOnly", () => {
  it("synthesizes a full Breakdown from frozen figures alone, for when settle() can no longer accept the link's inputs", () => {
    const breakdown = breakdownFromFrozenOnly({
      grossPaidMinorUnits: 100_000,
      payCurrency: "CAD",
      buyerMarket: "OTHER",
      fx: { rate: 0.73, asOf: "2026-08-10" },
      scheduleAsOf: "2026-05-28",
      frozen: { feeMinorUnits: 4655, netMinorUnits: 66_818, spreadMinorUnits: 2784 },
    });

    expect(breakdown.grossPaid).toEqual({ currency: "CAD", minorUnits: 100_000 });
    expect(breakdown.commercialFee.minorUnits).toBe(4655);
    expect(breakdown.commercialFee.currency).toBe("CAD");
    expect(breakdown.fxConversion?.minorUnits).toBe(2784);
    expect(breakdown.fxConversion?.currency).toBe("USD");
    expect(breakdown.received).toEqual({ currency: "USD", minorUnits: 66_818 });
    expect(breakdown.ratesAsOf).toBe("2026-05-28");
  });

  it("omits fxConversion for a USD link with no fx", () => {
    const breakdown = breakdownFromFrozenOnly({
      grossPaidMinorUnits: 10_000,
      payCurrency: "USD",
      buyerMarket: "OTHER",
      scheduleAsOf: "2026-05-28",
      frozen: { feeMinorUnits: 480, netMinorUnits: 9_520 },
    });
    expect(breakdown.fxConversion).toBeNull();
    expect(breakdown.received).toEqual({ currency: "USD", minorUnits: 9_520 });
  });
});
