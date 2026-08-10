import { describe, expect, it } from "vitest";
import { settle } from "../fees/engine";
import { hasFrozenDrift } from "./drift";

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

  it("is false for a USD breakdown with no spread, without a null-vs-undefined false positive", () => {
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

  it("is true when a forged/arbitrary fee and net are supplied (drift detection doesn't validate provenance, only flags disagreement)", () => {
    const breakdown = settle({
      grossPaidMinorUnits: 100_000,
      payCurrency: "USD",
      buyerMarket: "OTHER",
      monthlyVolumeUSDCents: 0,
    });
    expect(hasFrozenDrift(breakdown, { feeMinorUnits: 1, netMinorUnits: 99_999 })).toBe(true);
  });
});
