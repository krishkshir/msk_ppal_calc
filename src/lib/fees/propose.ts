import {
  predictionSpread,
  solveCommercial,
  solveConversionSpread,
  solveCurrencyFixedFee,
  type AmountSpread,
  type ConversionObservation,
  type CurrencyFeeObservation,
  type FeasibleModel,
  type FeeObservation,
  type SpreadBand,
} from "./solve";

export interface IdentifiedFeeObservation extends FeeObservation {
  id: string;
}

export interface CurrentCommercialModel {
  fixedFeeMinorUnits: number;
  rate: number;
}

/**
 * Predicted fees must agree to within this many minor units across
 * REPRESENTATIVE_AMOUNTS_MINOR_UNITS before a re-derived model counts as
 * "determined enough to use" — see docs/plan-v0.5.html "The finding that
 * shapes the whole design." Never zero: distinct feasible models can
 * differ by a rounding artifact at some amount while being, for every
 * practical purpose, the same model.
 */
export const FEE_AGREEMENT_TOLERANCE_MINOR_UNITS = 1;

/**
 * Spans well beyond T1-T3's observed range ($83-$120) up to $1,000 — an
 * order of magnitude past her largest real transaction, not just the
 * amounts already observed (which trivially agree by construction).
 * Deliberately doesn't reach further: even a single, fully-pinned
 * feasible model has a rate band of nonzero width, so predicted-fee
 * spread grows with amount regardless of how much data exists (see
 * predictionSpread) — testing against amounts far outside Ms. K's actual
 * invoice range would make "propose" nearly unreachable for a business
 * that has never seen a transaction over $150, not because the model is
 * genuinely undetermined but because the question stopped being one she
 * needs answered.
 */
export const REPRESENTATIVE_AMOUNTS_MINOR_UNITS = [5_000, 10_000, 25_000, 50_000, 100_000];

export type CommercialVerdict =
  | { kind: "contradiction"; conflicting: IdentifiedFeeObservation[] }
  | {
      kind: "confirmed";
      feasible: FeasibleModel[];
      confirmedBand: FeasibleModel;
      confirmedByCount: number;
    }
  | { kind: "propose"; feasible: FeasibleModel[]; proposedModel: FeasibleModel; spread: AmountSpread[] }
  | {
      kind: "unresolved";
      feasible: FeasibleModel[];
      spread: AmountSpread[];
      largestObservedGrossMinorUnits: number;
    };

/**
 * Which observation(s) are responsible for an empty feasible set — tries
 * dropping each one in turn; if the rest solve successfully, that
 * observation is a suspect. If removing *any single* observation restores
 * feasibility, every observation looks equally suspect by this test even
 * though the truth is some smaller subset is wrong — reporting the full
 * set in that case is honest about the ambiguity rather than guessing.
 */
function findConflicting(
  observations: readonly IdentifiedFeeObservation[],
): IdentifiedFeeObservation[] {
  const suspects = observations.filter((_, i) => {
    const withoutI = observations.filter((_unused, j) => j !== i);
    return withoutI.length > 0 && solveCommercial(withoutI).length > 0;
  });
  return suspects.length > 0 ? suspects : [...observations];
}

/**
 * The commercial-rate decision table from docs/plan-v0.5.html: contradict
 * / confirm-no-proposal / propose / rule-out-but-unresolved. Seeded with
 * only T1-T3 this must return "confirmed" (the current $0.31/4.625% model
 * is one of six feasible fixed fees) — never "propose", which would mean
 * silently replacing it with an equally-feasible neighbour.
 */
export function decideCommercial(
  observations: readonly IdentifiedFeeObservation[],
  current: CurrentCommercialModel,
): CommercialVerdict {
  const feasible = solveCommercial(observations);

  if (feasible.length === 0) {
    return { kind: "contradiction", conflicting: findConflicting(observations) };
  }

  const currentBand = feasible.find((m) => m.fixedFeeMinorUnits === current.fixedFeeMinorUnits);
  const currentIsFeasible =
    currentBand != null && current.rate >= currentBand.rateLo && current.rate < currentBand.rateHi;

  if (currentIsFeasible) {
    return {
      kind: "confirmed",
      feasible,
      confirmedBand: currentBand,
      confirmedByCount: observations.length,
    };
  }

  const spread = predictionSpread(feasible, REPRESENTATIVE_AMOUNTS_MINOR_UNITS);
  const maxDelta = Math.max(...spread.map((s) => s.maxFeeMinorUnits - s.minFeeMinorUnits));

  if (maxDelta <= FEE_AGREEMENT_TOLERANCE_MINOR_UNITS) {
    // Every feasible model agrees closely enough to propose one. The
    // median by fixed fee is a *display* choice, not a uniqueness claim —
    // feasible[] always ships alongside it so a reviewer sees the whole band.
    const proposedModel = feasible[Math.floor(feasible.length / 2)]!;
    return { kind: "propose", feasible, proposedModel, spread };
  }

  return {
    kind: "unresolved",
    feasible,
    spread,
    largestObservedGrossMinorUnits: Math.max(...observations.map((o) => o.grossPaidMinorUnits)),
  };
}

export type CurrencyFeeVerdict =
  | { kind: "no-data" }
  | { kind: "contradiction" }
  | { kind: "confirmed"; feasible: number[] }
  | { kind: "propose"; feasible: number[]; proposedFixedFeeMinorUnits: number };

/**
 * One currency's fixed-fee decision, given the commercial rate as already
 * known. `observations` must already be filtered to a single currency —
 * solveCurrencyFixedFee groups internally, but the verdict (confirmed vs.
 * propose vs. contradiction) is inherently per currency, so mixing
 * currencies here would blur three independent answers into one.
 */
export function decideCurrencyFixedFee(
  observations: readonly CurrencyFeeObservation[],
  rate: number,
  currentFixedFeeMinorUnits: number,
): CurrencyFeeVerdict {
  if (observations.length === 0) {
    return { kind: "no-data" };
  }
  const feasible = solveCurrencyFixedFee(observations, rate).map((f) => f.fixedFeeMinorUnits);
  if (feasible.length === 0) {
    return { kind: "contradiction" };
  }
  if (feasible.includes(currentFixedFeeMinorUnits)) {
    return { kind: "confirmed", feasible };
  }
  return {
    kind: "propose",
    feasible,
    proposedFixedFeeMinorUnits: feasible[Math.floor(feasible.length / 2)]!,
  };
}

/** 0.05 percentage points — narrow enough to treat the FX spread as determined. */
export const SPREAD_AGREEMENT_TOLERANCE = 0.0005;

export type SpreadVerdict =
  | { kind: "no-data" }
  | { kind: "contradiction" }
  | { kind: "confirmed"; band: SpreadBand }
  | { kind: "propose"; band: SpreadBand; proposedSpreadRate: number }
  | { kind: "unresolved"; band: SpreadBand; reason: "not-pinned" | "band-too-wide" };

/**
 * The FX-spread decision. Unlike the commercial and per-currency-fee
 * verdicts, a feasible band that doesn't contain the current spread is
 * *not* automatically a proposal: if every contributing observation used
 * an assumed (not independently observed) fixed fee, the band is only as
 * trustworthy as that assumption, and proposing a spread change on it
 * would let an unvalidated fixed fee masquerade as evidence about the
 * spread. That case reports "unresolved", not "propose" — see
 * docs/plan-v0.5.html "Known limitations".
 */
export function decideSpread(
  observations: readonly ConversionObservation[],
  currentSpreadRate: number,
): SpreadVerdict {
  if (observations.length === 0) {
    return { kind: "no-data" };
  }
  const band = solveConversionSpread(observations);
  if (band == null) {
    return { kind: "contradiction" };
  }

  const currentIsFeasible = currentSpreadRate >= band.lo && currentSpreadRate < band.hi;
  if (currentIsFeasible) {
    return { kind: "confirmed", band };
  }
  if (!band.pinnedByDirectObservation) {
    return { kind: "unresolved", band, reason: "not-pinned" };
  }
  if (band.hi - band.lo > SPREAD_AGREEMENT_TOLERANCE) {
    return { kind: "unresolved", band, reason: "band-too-wide" };
  }
  return { kind: "propose", band, proposedSpreadRate: (band.lo + band.hi) / 2 };
}
