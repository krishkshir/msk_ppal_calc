import { formatMoney } from "@/lib/format";
import { CURRENCIES, currencySpec } from "./currencies";
import { ledgerRateAppliesToMarket, type ActiveFeeModelRow } from "./model";
import { findOverride, targetKey, type ActiveOverrides, type OverrideTarget } from "./overrides";
import {
  FX_SPREAD_RATE,
  FX_SPREAD_SOURCE_ID,
  isQuotedTier,
  SCHEDULE,
  SCHEDULE_EFFECTIVE_FROM,
  type ScheduleEntry,
} from "./schedule";
import { feeSource, type FeeSource } from "./sources";

/** One row of the rates-and-fees table on /ledger (src/components/ledger/rates-table.tsx). */
export interface RateRow {
  targetKey: string;
  target: OverrideTarget;
  label: string;
  display: string;
  /**
   * The currently-effective value, pre-formatted for the override form's
   * value input — a percentage string ("4.625") for a rate/spread target,
   * a major-unit money string ("0.31") for a fixed-fee target. Matches
   * exactly what src/app/ledger/actions.ts's setOverrideAction parses
   * back, so the unit conversion (including JPY's minor-unit exponent)
   * lives in this one file, not duplicated in the form component.
   */
  formValue: string;
  source: FeeSource;
  effectiveDate: string;
  setBy?: string;
  setAt?: string;
  /** What an active override is masking — the figure that would otherwise be in force. */
  baseline?: { display: string; source: FeeSource; effectiveDate: string };
  note?: string;
  /** False for the volume tiers Ms. K doesn't qualify for (CLAUDE.md "Domain model"). */
  applicable: boolean;
}

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(3)}%`;
}

function percentFormValue(rate: number): string {
  return String(Number((rate * 100).toFixed(4)));
}

function moneyFormValue(minorUnits: number, currency: (typeof CURRENCIES)[number]["code"]): string {
  return String(minorUnits / 10 ** currencySpec(currency).minorUnitExponent);
}

function volumeLabel(entry: ScheduleEntry): string {
  if (entry.maxMonthlyVolumeUSDCents === null) {
    return `above ${formatMoney(entry.minMonthlyVolumeUSDCents - 1, "USD")}`;
  }
  return `${formatMoney(entry.minMonthlyVolumeUSDCents, "USD")}–${formatMoney(entry.maxMonthlyVolumeUSDCents, "USD")}`;
}

function rateLabel(entry: ScheduleEntry): string {
  if (entry.buyerMarket === "UAE") return "UAE";
  if (entry.buyerMarket === "EEA_UK") return "EEA & UK";
  return `Rest of world · ${volumeLabel(entry)}`;
}

interface Baseline {
  display: string;
  source: FeeSource;
  effectiveDate: string;
  note?: string;
}

function commercialRateBaseline(entry: ScheduleEntry, activeModel: ActiveFeeModelRow | null): Baseline {
  if (activeModel && ledgerRateAppliesToMarket(entry.buyerMarket)) {
    return {
      display: formatRate(activeModel.rate),
      source: feeSource("ledgerModel"),
      effectiveDate: activeModel.asOf,
    };
  }
  return {
    display: formatRate(entry.rate),
    source: feeSource(entry.sourceId),
    effectiveDate: entry.effectiveFrom,
    note: entry.note,
  };
}

function commercialRateRows(activeModel: ActiveFeeModelRow | null, overrides: ActiveOverrides): RateRow[] {
  return SCHEDULE.map((entry) => {
    const target: OverrideTarget = {
      kind: "rate",
      buyerMarket: entry.buyerMarket,
      minMonthlyVolumeUSDCents: entry.minMonthlyVolumeUSDCents,
    };
    const applicable = isQuotedTier(entry.buyerMarket, entry.minMonthlyVolumeUSDCents);
    const baseline = commercialRateBaseline(entry, activeModel);
    const override = findOverride(overrides, target);

    if (override) {
      return {
        targetKey: targetKey(target),
        target,
        label: rateLabel(entry),
        display: formatRate(override.value),
        formValue: percentFormValue(override.value),
        source: feeSource("manualOverride"),
        effectiveDate: override.effectiveFrom,
        setBy: override.setByEmail ?? undefined,
        setAt: override.setAt,
        baseline,
        note: override.note ?? undefined,
        applicable,
      };
    }

    const currentRate = activeModel && ledgerRateAppliesToMarket(entry.buyerMarket) ? activeModel.rate : entry.rate;
    return {
      targetKey: targetKey(target),
      target,
      label: rateLabel(entry),
      display: baseline.display,
      formValue: percentFormValue(currentRate),
      source: baseline.source,
      effectiveDate: baseline.effectiveDate,
      note: baseline.note,
      applicable,
    };
  });
}

function fixedFeeRows(activeModel: ActiveFeeModelRow | null, overrides: ActiveOverrides): RateRow[] {
  return CURRENCIES.map((spec) => {
    const target: OverrideTarget = { kind: "fixedFee", currency: spec.code };
    const ledgerValue =
      spec.code === "USD" ? activeModel?.fixedFeeMinorUnits : activeModel?.perCurrencyFixedFees[spec.code];

    const baseline: Baseline =
      ledgerValue != null && activeModel
        ? {
            display: formatMoney(ledgerValue, spec.code),
            source: feeSource("ledgerModel"),
            effectiveDate: activeModel.asOf,
          }
        : {
            display: formatMoney(spec.fixedFeeMinorUnits, spec.code),
            source: feeSource(spec.sourceId),
            effectiveDate: spec.effectiveFrom,
            note: spec.note,
          };

    const override = findOverride(overrides, target);
    if (override) {
      return {
        targetKey: targetKey(target),
        target,
        label: `${spec.code} — ${spec.label}`,
        display: formatMoney(override.value, spec.code),
        formValue: moneyFormValue(override.value, spec.code),
        source: feeSource("manualOverride"),
        effectiveDate: override.effectiveFrom,
        setBy: override.setByEmail ?? undefined,
        setAt: override.setAt,
        baseline,
        note: override.note ?? undefined,
        applicable: true,
      };
    }

    const currentMinorUnits = ledgerValue ?? spec.fixedFeeMinorUnits;
    return {
      targetKey: targetKey(target),
      target,
      label: `${spec.code} — ${spec.label}`,
      display: baseline.display,
      formValue: moneyFormValue(currentMinorUnits, spec.code),
      source: baseline.source,
      effectiveDate: baseline.effectiveDate,
      note: baseline.note,
      applicable: true,
    };
  });
}

function fxSpreadRow(activeModel: ActiveFeeModelRow | null, overrides: ActiveOverrides): RateRow {
  const target: OverrideTarget = { kind: "fxSpread" };
  const baseline: Baseline = activeModel
    ? {
        display: formatRate(activeModel.fxSpreadRate),
        source: feeSource("ledgerModel"),
        effectiveDate: activeModel.asOf,
      }
    : {
        display: formatRate(FX_SPREAD_RATE),
        source: feeSource(FX_SPREAD_SOURCE_ID),
        effectiveDate: SCHEDULE_EFFECTIVE_FROM,
      };

  const override = findOverride(overrides, target);
  if (override) {
    return {
      targetKey: targetKey(target),
      target,
      label: "Currency conversion spread",
      display: formatRate(override.value),
      formValue: percentFormValue(override.value),
      source: feeSource("manualOverride"),
      effectiveDate: override.effectiveFrom,
      setBy: override.setByEmail ?? undefined,
      setAt: override.setAt,
      baseline,
      note: override.note ?? undefined,
      applicable: true,
    };
  }

  const currentSpread = activeModel?.fxSpreadRate ?? FX_SPREAD_RATE;
  return {
    targetKey: targetKey(target),
    target,
    label: "Currency conversion spread",
    display: baseline.display,
    formValue: percentFormValue(currentSpread),
    source: baseline.source,
    effectiveDate: baseline.effectiveDate,
    note: baseline.note,
    applicable: true,
  };
}

/**
 * Resolves every rate and fee the engine can use — static table, ledger
 * model, manual override — into one flat, display-ready list. Pure and
 * DB-agnostic so it's testable without Supabase; mirrors exactly the
 * precedence src/lib/fees/model.ts's resolveFeeModel applies at
 * calculation time, so the table never shows a different figure than
 * settle()/quote() would actually use — for every row where
 * `applicable` is true. The three higher OTHER-market volume tiers
 * (`applicable: false`, isQuotedTier in schedule.ts) are still listed
 * for visibility but resolveFeeModel never looks them up (it's pinned to
 * selectTier(buyerMarket, 0)) and, as of this fix, can no longer be
 * overridden either.
 */
export function buildRateRows(activeModel: ActiveFeeModelRow | null, overrides: ActiveOverrides): RateRow[] {
  return [
    ...commercialRateRows(activeModel, overrides),
    ...fixedFeeRows(activeModel, overrides),
    fxSpreadRow(activeModel, overrides),
  ];
}
