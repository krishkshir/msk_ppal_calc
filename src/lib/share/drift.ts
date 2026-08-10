import { ACCOUNT_CURRENCY } from "../fees/schedule";
import type { Breakdown } from "../fees/types";
import type { SharedBreakdown } from "./breakdown-link";

type Frozen = NonNullable<SharedBreakdown["frozen"]>;

/**
 * Whether a fresh settle() recomputation disagrees with the figures a
 * share link had frozen at creation time. This is the drift signal
 * scheduleAsOf can't provide on its own — a calculation-methodology
 * change (e.g. v0.4's CAD fixed-fee lookup) can move these numbers
 * without moving SCHEDULE_EFFECTIVE_FROM at all. See
 * docs/plan-share-link-drift.html.
 */
export function hasFrozenDrift(breakdown: Breakdown, frozen: Frozen): boolean {
  return (
    breakdown.commercialFee.minorUnits !== frozen.feeMinorUnits ||
    breakdown.received.minorUnits !== frozen.netMinorUnits ||
    (breakdown.fxConversion?.minorUnits ?? null) !== (frozen.spreadMinorUnits ?? null)
  );
}

/**
 * Overrides a freshly recomputed Breakdown's amounts with the figures a
 * share link actually quoted, so a drifted link shows what the client
 * was originally told rather than a number that never applied to them.
 * ratesAsOf is frozen too, so the footer date matches the figures above
 * it instead of contradicting them with the current schedule's date.
 */
export function applyFrozenFigures(
  breakdown: Breakdown,
  frozen: Frozen,
  scheduleAsOf: string,
): Breakdown {
  return {
    ...breakdown,
    commercialFee: { ...breakdown.commercialFee, minorUnits: frozen.feeMinorUnits },
    fxConversion:
      breakdown.fxConversion && frozen.spreadMinorUnits !== undefined
        ? { ...breakdown.fxConversion, minorUnits: frozen.spreadMinorUnits }
        : breakdown.fxConversion,
    received: { ...breakdown.received, minorUnits: frozen.netMinorUnits },
    ratesAsOf: scheduleAsOf,
  };
}

/**
 * Synthesizes a Breakdown purely from a link's frozen figures, for when
 * settle() no longer accepts this link's inputs at all under the current
 * engine (e.g. a fixed fee that's since grown past the gross amount). A
 * shared link should never become completely unrenderable just because
 * the current engine can't recompute it — it can still show what the
 * client was originally quoted.
 */
export function breakdownFromFrozenOnly(shared: SharedBreakdown & { frozen: Frozen }): Breakdown {
  const { grossPaidMinorUnits, payCurrency, fx, frozen, scheduleAsOf } = shared;
  const note =
    "This payment's inputs can no longer be recomputed under the current fee schedule; " +
    "showing the amounts originally quoted for this link.";

  return {
    grossPaid: { currency: payCurrency, minorUnits: grossPaidMinorUnits },
    commercialFee: {
      label: "Cross-border transaction fee",
      minorUnits: frozen.feeMinorUnits,
      currency: payCurrency,
      confidence: "estimated",
      note,
    },
    fxConversion:
      fx && frozen.spreadMinorUnits !== undefined
        ? {
            label: "Currency conversion spread",
            minorUnits: frozen.spreadMinorUnits,
            currency: ACCOUNT_CURRENCY,
            confidence: "estimated",
            note,
          }
        : null,
    received: { currency: ACCOUNT_CURRENCY, minorUnits: frozen.netMinorUnits },
    ratesAsOf: scheduleAsOf,
  };
}
