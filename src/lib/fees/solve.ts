import { currencySpec, fxRateInMinorUnits, type Currency } from "./currencies";
import { roundHalfUp } from "./money";

/**
 * A transaction where the commercial fee is known directly, in the same
 * currency as the gross amount — isolating the fee from any FX effect.
 * True for every USD transaction (received IS the net, no conversion
 * involved), and for any non-USD transaction where PayPal's own fee line
 * was read off the transaction and entered directly.
 */
export interface FeeObservation {
  grossPaidMinorUnits: number;
  actualFeeMinorUnits: number;
}

export interface FeasibleModel {
  fixedFeeMinorUnits: number;
  /** Inclusive. */
  rateLo: number;
  /** Exclusive. */
  rateHi: number;
}

/**
 * Covers every currencies.ts fixed fee (HUF's 9000 is the highest
 * published figure) with headroom for a currency added later.
 */
const MAX_FIXED_FEE_MINOR_UNITS = 12_000;

/**
 * All (fixedFee, rateBand) pairs that reproduce every observation to the
 * cent. Exploits fixedFeeMinorUnits being an integer: for a candidate f,
 * `fee = roundHalfUp(gross*r + f)` pins r to an exact half-open interval
 * per observation; intersecting those intervals either narrows the band
 * or empties it (a contradiction between observations).
 *
 * This deliberately never collapses to one rate, no matter how much data
 * accumulates — each additional f narrows its own rate interval but a
 * neighbouring f can still fit. See docs/plan-v0.5.html "The finding that
 * shapes the whole design": callers must judge whether the model is good
 * enough via predictionSpread, not by checking this array's length.
 */
export function solveCommercial(observations: readonly FeeObservation[]): FeasibleModel[] {
  const feasible: FeasibleModel[] = [];
  if (observations.length === 0) {
    return feasible;
  }
  for (let f = 0; f <= MAX_FIXED_FEE_MINOR_UNITS; f++) {
    let lo = -Infinity;
    let hi = Infinity;
    for (const obs of observations) {
      const obsLo = (obs.actualFeeMinorUnits - 0.5 - f) / obs.grossPaidMinorUnits;
      const obsHi = (obs.actualFeeMinorUnits + 0.5 - f) / obs.grossPaidMinorUnits;
      lo = Math.max(lo, obsLo);
      hi = Math.min(hi, obsHi);
    }
    if (lo < hi) {
      feasible.push({ fixedFeeMinorUnits: f, rateLo: lo, rateHi: hi });
    }
  }
  return feasible;
}

export interface AmountSpread {
  grossPaidMinorUnits: number;
  minFeeMinorUnits: number;
  maxFeeMinorUnits: number;
}

/**
 * The min/max fee every feasible model predicts at each amount — the
 * actual uniqueness signal this project uses (see plan doc): not "is the
 * model unique" (never, by construction) but "do all feasible models
 * agree closely enough at the amounts Ms. K actually invoices."
 * `fee = roundHalfUp(gross*r + f)` is monotonic non-decreasing in r for
 * gross > 0, so the extremes of each model's rate band are always where
 * its own min/max fee occurs — no need to sample the interior.
 */
export function predictionSpread(
  feasible: readonly FeasibleModel[],
  amounts: readonly number[],
): AmountSpread[] {
  return amounts.map((grossPaidMinorUnits) => {
    let min = Infinity;
    let max = -Infinity;
    for (const { fixedFeeMinorUnits, rateLo, rateHi } of feasible) {
      // rateHi is exclusive; evaluate just inside it rather than at the
      // open boundary, consistent with roundHalfUp's own half-open bands.
      for (const rate of [rateLo, rateHi - 1e-9]) {
        const fee = roundHalfUp(grossPaidMinorUnits * rate + fixedFeeMinorUnits);
        min = Math.min(min, fee);
        max = Math.max(max, fee);
      }
    }
    return { grossPaidMinorUnits, minFeeMinorUnits: min, maxFeeMinorUnits: max };
  });
}

export interface CurrencyFeeObservation extends FeeObservation {
  payCurrency: Currency;
}

export interface FeasibleCurrencyFee {
  payCurrency: Currency;
  fixedFeeMinorUnits: number;
}

/**
 * Per-currency fixed fee, given the commercial rate as already known (a
 * single point — the currently accepted rate, or a chosen point within
 * solveCommercial's band). The rate is shared across currencies
 * (schedule.ts keys it by market/volume, not currency), so once it's
 * pinned from USD observations, a non-USD observation with a *known*
 * actual fee (PayPal's own fee line, entered directly) constrains that
 * currency's fixed fee to a real-valued interval of width 1 — at most two
 * integers can land in it.
 *
 * Requires the observation's fee to be known directly. Without it, fee
 * and the FX spread are two unknowns tangled through a single equation
 * (grossPaid -> receivedUSD) and cannot be separated from that
 * transaction alone — see docs/plan-v0.5.html "Known limitations."
 */
export function solveCurrencyFixedFee(
  observations: readonly CurrencyFeeObservation[],
  rate: number,
): FeasibleCurrencyFee[] {
  const byCurrency = new Map<Currency, FeeObservation[]>();
  for (const obs of observations) {
    const list = byCurrency.get(obs.payCurrency) ?? [];
    list.push(obs);
    byCurrency.set(obs.payCurrency, list);
  }

  const result: FeasibleCurrencyFee[] = [];
  for (const [payCurrency, obsList] of byCurrency) {
    let lo = -Infinity;
    let hi = Infinity;
    for (const obs of obsList) {
      lo = Math.max(lo, obs.actualFeeMinorUnits - 0.5 - obs.grossPaidMinorUnits * rate);
      hi = Math.min(hi, obs.actualFeeMinorUnits + 0.5 - obs.grossPaidMinorUnits * rate);
    }
    if (lo >= hi) {
      continue; // this currency's observations contradict each other at this rate — caller reports it
    }
    const feeLo = Math.max(0, Math.ceil(lo));
    const feeHi = Math.min(MAX_FIXED_FEE_MINOR_UNITS, Math.floor(hi - 1e-9));
    for (let f = feeLo; f <= feeHi; f++) {
      result.push({ payCurrency, fixedFeeMinorUnits: f });
    }
  }
  return result;
}

export interface ConversionObservation {
  payCurrency: Currency;
  grossPaidMinorUnits: number;
  /**
   * The commercial fee in payCurrency — known (PayPal's own fee line, or
   * an already-solved currency fixed fee) or assumed (the currency's
   * currently modeled fixed fee, used as a working prior). See
   * `feeIsAssumed`.
   */
  commercialFeeMinorUnits: number;
  receivedUSDMinorUnits: number;
  /** USD per 1 major unit of payCurrency, on the transaction's payment date. */
  fxReferenceRate: number;
  /**
   * False only when commercialFeeMinorUnits came from a real observation
   * (PayPal's own displayed fee, or solveCurrencyFixedFee's output) —
   * true when it's merely the currency's currently modeled figure,
   * assumed for lack of anything better. An observation with
   * feeIsAssumed still narrows the spread band, but shouldn't be the sole
   * basis for proposing a new spread — see SpreadBand.pinnedByDirectObservation.
   */
  feeIsAssumed: boolean;
}

export interface SpreadBand {
  /** Approximate — see the note on interval direction in solveConversionSpread. */
  lo: number;
  hi: number;
  pinnedByDirectObservation: boolean;
}

/**
 * The FX spread is global — one figure applied to every currency
 * conversion (schedule.ts's FX_SPREAD_RATE), not per-currency — so unlike
 * the fixed fee, every observation constrains the *same* unknown and all
 * intervals intersect directly, with no per-currency grouping needed.
 *
 * `predictedReceived = roundHalfUp(net * fxRate * (1 - spread))` is
 * solved by first bounding `(1 - spread)`, then negating — negation flips
 * which end of the interval is inclusive vs. exclusive. That flip is
 * approximated here as closed-low/open-high like every other interval in
 * this module; the only case it can mis-classify is an exact boundary
 * value, which changes nothing observable in a UI reporting to the cent.
 */
export function solveConversionSpread(
  observations: readonly ConversionObservation[],
): SpreadBand | null {
  let lo = -Infinity;
  let hi = Infinity;
  let pinnedByDirectObservation = false;
  let sawObservation = false;

  for (const obs of observations) {
    const net = obs.grossPaidMinorUnits - obs.commercialFeeMinorUnits;
    if (net <= 0) {
      continue; // guarded upstream; skip defensively rather than dividing by a non-positive net
    }
    const fxRate = fxRateInMinorUnits(obs.fxReferenceRate, obs.payCurrency);
    if (fxRate <= 0) {
      continue;
    }
    sawObservation = true;

    const oneMinusSpreadLo = (obs.receivedUSDMinorUnits - 0.5) / (net * fxRate);
    const oneMinusSpreadHi = (obs.receivedUSDMinorUnits + 0.5) / (net * fxRate);
    const spreadLo = 1 - oneMinusSpreadHi;
    const spreadHi = 1 - oneMinusSpreadLo;

    lo = Math.max(lo, spreadLo);
    hi = Math.min(hi, spreadHi);
    if (!obs.feeIsAssumed) {
      pinnedByDirectObservation = true;
    }
  }

  if (!sawObservation || lo >= hi) {
    return null;
  }
  return { lo, hi, pinnedByDirectObservation };
}

/**
 * Currency spec lookup re-exported for convenience so callers building
 * ConversionObservation.fxReferenceRate scaling don't need a second
 * import — solve.ts otherwise depends only on currencies.ts and money.ts,
 * never on engine.ts, so there's no import cycle when engine.ts later
 * consumes this module's output via a re-derived FeeModel.
 */
export { currencySpec };
