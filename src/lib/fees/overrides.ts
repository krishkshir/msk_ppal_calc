import { isCurrency, type Currency } from "./currencies";
import { isBuyerMarket, type BuyerMarket } from "./markets";
import { SCHEDULE } from "./schedule";

/**
 * What a manually-typed rate/fee correction applies to. A generic keyed
 * target, not extra fee_models columns, because fee_models.rate can only
 * ever express the OTHER-market rate (see model.ts's resolveFeeModel) —
 * an override must be able to name any SCHEDULE tier, any currency's
 * fixed fee, or the FX spread. See docs/plan-v0.6.html "Override
 * targets."
 */
export type OverrideTarget =
  | { kind: "rate"; buyerMarket: BuyerMarket; minMonthlyVolumeUSDCents: number }
  | { kind: "fixedFee"; currency: Currency }
  | { kind: "fxSpread" };

/** "rate:OTHER:0" | "fixedFee:CAD" | "fxSpread" — the fee_overrides.target_key column's format. */
export function targetKey(target: OverrideTarget): string {
  switch (target.kind) {
    case "rate":
      return `rate:${target.buyerMarket}:${target.minMonthlyVolumeUSDCents}`;
    case "fixedFee":
      return `fixedFee:${target.currency}`;
    case "fxSpread":
      return "fxSpread";
  }
}

/**
 * Validated against the real SCHEDULE/CURRENCIES tables, not just parsed
 * — a target_key is attacker-editable form input (or a stored row from an
 * older app version whose SCHEDULE has since changed), so a syntactically
 * valid key naming a tier or currency that no longer exists must still
 * fail here.
 */
export function parseTargetKey(key: string): OverrideTarget | null {
  if (key === "fxSpread") {
    return { kind: "fxSpread" };
  }

  const rateMatch = /^rate:([A-Z_]+):(\d+)$/.exec(key);
  if (rateMatch) {
    const [, buyerMarketRaw, minRaw] = rateMatch;
    if (!buyerMarketRaw || !minRaw || !isBuyerMarket(buyerMarketRaw)) return null;
    const minMonthlyVolumeUSDCents = Number(minRaw);
    const tierExists = SCHEDULE.some(
      (entry) =>
        entry.buyerMarket === buyerMarketRaw &&
        entry.minMonthlyVolumeUSDCents === minMonthlyVolumeUSDCents,
    );
    if (!tierExists) return null;
    return { kind: "rate", buyerMarket: buyerMarketRaw, minMonthlyVolumeUSDCents };
  }

  const fixedFeeMatch = /^fixedFee:([A-Z]{3})$/.exec(key);
  if (fixedFeeMatch) {
    const [, currencyRaw] = fixedFeeMatch;
    if (!currencyRaw || !isCurrency(currencyRaw)) return null;
    return { kind: "fixedFee", currency: currencyRaw };
  }

  return null;
}

const MAX_RATE = 0.5;
const MAX_FIXED_FEE_MINOR_UNITS = 1_000_000;

/** Returns an error message, or null if the value is valid for this target. */
export function validateOverrideValue(target: OverrideTarget, value: number): string | null {
  if (!Number.isFinite(value)) {
    return "Enter a number.";
  }
  if (target.kind === "fixedFee") {
    if (!Number.isInteger(value) || value < 0 || value > MAX_FIXED_FEE_MINOR_UNITS) {
      return "Fixed fee must be a whole number of minor units, between 0 and 1,000,000.";
    }
    return null;
  }
  if (value < 0 || value > MAX_RATE) {
    return "Rate must be between 0% and 50%.";
  }
  return null;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A figure can't already be in force from a date that hasn't happened —
 * effectiveFrom is when it actually took effect, not when it was typed
 * (that's setAt, stamped by the database, never user input).
 */
export function validateEffectiveFrom(date: string, today: Date = new Date()): string | null {
  if (!DATE_PATTERN.test(date)) {
    return "Enter a date as YYYY-MM-DD.";
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return "Enter a valid date.";
  }
  const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (parsed.getTime() > todayUTC.getTime()) {
    return "Effective date can't be in the future.";
  }
  return null;
}

/** A row from fee_overrides — the newest non-cleared row for its target_key. */
export interface Override {
  targetKey: string;
  /** Rate/spread as a fraction (0.04625); fixed fee as integer minor units. */
  value: number;
  effectiveFrom: string;
  setByEmail: string | null;
  setAt: string;
  note: string | null;
}

/** One entry per target — src/lib/db/fee-overrides.ts's getActiveOverrides() already collapses history to the newest non-cleared row per target_key. */
export type ActiveOverrides = readonly Override[];

export function findOverride(overrides: ActiveOverrides, target: OverrideTarget): Override | undefined {
  const key = targetKey(target);
  return overrides.find((o) => o.targetKey === key);
}
