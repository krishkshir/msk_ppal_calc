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
 *
 * A warning signal only, never a source of truth: fee/net/spread are
 * unsigned, attacker-editable query params with no cryptographic link to
 * a genuine past settle() output, so the shared page always displays the
 * recomputed figures and uses this only to decide whether to warn —
 * never to choose what to show.
 */
export function hasFrozenDrift(breakdown: Breakdown, frozen: Frozen): boolean {
  return (
    breakdown.commercialFee.minorUnits !== frozen.feeMinorUnits ||
    breakdown.received.minorUnits !== frozen.netMinorUnits ||
    (breakdown.fxConversion?.minorUnits ?? null) !== (frozen.spreadMinorUnits ?? null)
  );
}
