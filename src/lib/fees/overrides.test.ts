import { describe, expect, it } from "vitest";
import { parseAmountToMinorUnits } from "@/lib/format";
import {
  parseTargetKey,
  targetKey,
  validateEffectiveFrom,
  validateOverrideValue,
  type OverrideTarget,
} from "./overrides";
import { isQuotedTier, SCHEDULE } from "./schedule";

describe("targetKey / parseTargetKey round-trip", () => {
  const cases: OverrideTarget[] = [
    { kind: "rate", buyerMarket: "OTHER", minMonthlyVolumeUSDCents: 0 },
    { kind: "rate", buyerMarket: "UAE", minMonthlyVolumeUSDCents: 0 },
    { kind: "rate", buyerMarket: "EEA_UK", minMonthlyVolumeUSDCents: 0 },
    { kind: "rate", buyerMarket: "OTHER", minMonthlyVolumeUSDCents: 300_001 },
    { kind: "fixedFee", currency: "USD" },
    { kind: "fixedFee", currency: "JPY" },
    { kind: "fxSpread" },
  ];

  for (const target of cases) {
    it(`round-trips ${JSON.stringify(target)}`, () => {
      expect(parseTargetKey(targetKey(target))).toEqual(target);
    });
  }

  it("produces the exact key shapes documented in docs/plan-v0.6.html", () => {
    expect(targetKey({ kind: "rate", buyerMarket: "OTHER", minMonthlyVolumeUSDCents: 0 })).toBe("rate:OTHER:0");
    expect(targetKey({ kind: "fixedFee", currency: "CAD" })).toBe("fixedFee:CAD");
    expect(targetKey({ kind: "fxSpread" })).toBe("fxSpread");
  });
});

describe("parseTargetKey rejects anything that doesn't match the real tables", () => {
  it("rejects an unknown buyer market", () => {
    expect(parseTargetKey("rate:MARS:0")).toBeNull();
  });

  it("rejects a rate tier bound that doesn't match any SCHEDULE entry", () => {
    expect(parseTargetKey("rate:OTHER:12345")).toBeNull();
  });

  it("rejects an unknown currency", () => {
    expect(parseTargetKey("fixedFee:XYZ")).toBeNull();
  });

  it("rejects a currency-shaped string that isn't actually supported", () => {
    expect(parseTargetKey("fixedFee:RUB")).toBeNull();
  });

  it("rejects malformed keys", () => {
    expect(parseTargetKey("")).toBeNull();
    expect(parseTargetKey("rate")).toBeNull();
    expect(parseTargetKey("rate:OTHER")).toBeNull();
    expect(parseTargetKey("fixedFee")).toBeNull();
    expect(parseTargetKey("fixedFee:usd")).toBeNull();
    expect(parseTargetKey("somethingElse:1")).toBeNull();
  });
});

describe("validateOverrideValue", () => {
  it("accepts a rate within [0, 0.5]", () => {
    expect(validateOverrideValue({ kind: "rate", buyerMarket: "OTHER", minMonthlyVolumeUSDCents: 0 }, 0.04625)).toBeNull();
    expect(validateOverrideValue({ kind: "fxSpread" }, 0)).toBeNull();
    expect(validateOverrideValue({ kind: "fxSpread" }, 0.5)).toBeNull();
  });

  it("rejects a rate outside [0, 0.5]", () => {
    expect(validateOverrideValue({ kind: "fxSpread" }, -0.01)).not.toBeNull();
    expect(validateOverrideValue({ kind: "fxSpread" }, 0.51)).not.toBeNull();
  });

  it("accepts an integer fixed fee within [0, 1_000_000]", () => {
    expect(validateOverrideValue({ kind: "fixedFee", currency: "USD" }, 31)).toBeNull();
    expect(validateOverrideValue({ kind: "fixedFee", currency: "JPY" }, 0)).toBeNull();
  });

  it("rejects a non-integer or out-of-range fixed fee", () => {
    expect(validateOverrideValue({ kind: "fixedFee", currency: "USD" }, 31.5)).not.toBeNull();
    expect(validateOverrideValue({ kind: "fixedFee", currency: "USD" }, -1)).not.toBeNull();
    expect(validateOverrideValue({ kind: "fixedFee", currency: "USD" }, 1_000_001)).not.toBeNull();
  });

  it("rejects a non-finite value", () => {
    expect(validateOverrideValue({ kind: "fxSpread" }, Number.NaN)).not.toBeNull();
  });
});

describe("validateEffectiveFrom", () => {
  const today = new Date("2026-08-11T12:00:00Z");

  it("accepts today and any past date", () => {
    expect(validateEffectiveFrom("2026-08-11", today)).toBeNull();
    expect(validateEffectiveFrom("2026-05-28", today)).toBeNull();
  });

  it("rejects a future date", () => {
    expect(validateEffectiveFrom("2026-08-12", today)).not.toBeNull();
  });

  it("rejects a malformed date", () => {
    expect(validateEffectiveFrom("08/11/2026", today)).not.toBeNull();
    expect(validateEffectiveFrom("not-a-date", today)).not.toBeNull();
  });
});

describe("isQuotedTier — the only tier a rate override can actually reach", () => {
  it("is true for the $0-$3,000 OTHER tier and false for the three higher OTHER tiers", () => {
    const otherTiers = SCHEDULE.filter((entry) => entry.buyerMarket === "OTHER");
    for (const entry of otherTiers) {
      expect(isQuotedTier("OTHER", entry.minMonthlyVolumeUSDCents)).toBe(entry.minMonthlyVolumeUSDCents === 0);
    }
    expect(otherTiers.filter((entry) => entry.minMonthlyVolumeUSDCents > 0).length).toBe(3);
  });

  it("is true for UAE and EEA_UK at their (only) tier", () => {
    const uae = SCHEDULE.find((entry) => entry.buyerMarket === "UAE")!;
    const eeaUk = SCHEDULE.find((entry) => entry.buyerMarket === "EEA_UK")!;
    expect(isQuotedTier("UAE", uae.minMonthlyVolumeUSDCents)).toBe(true);
    expect(isQuotedTier("EEA_UK", eeaUk.minMonthlyVolumeUSDCents)).toBe(true);
  });
});

describe("JPY minor-unit conversion — the trap CLAUDE.md warns about", () => {
  // The server action converts what a person types using
  // currencySpec(currency).minorUnitExponent (parseAmountToMinorUnits,
  // already used for every other money-shaped form field in this app) —
  // this locks in that typing "40" for JPY yields 40 minor units, not
  // 4000, before that conversion is wired into the override form.
  it("typing 40 for JPY's fixed fee yields 40 minor units, not 4000", () => {
    expect(parseAmountToMinorUnits("40", "JPY")).toBe(40);
  });

  it("typing 0.31 for USD's fixed fee yields 31 minor units", () => {
    expect(parseAmountToMinorUnits("0.31", "USD")).toBe(31);
  });
});
