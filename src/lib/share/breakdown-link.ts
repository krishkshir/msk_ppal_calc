import { CURRENCIES, isCurrency } from "../fees/currencies";
import { BUYER_MARKETS, isBuyerMarket } from "../fees/markets";
import { ACCOUNT_CURRENCY } from "../fees/schedule";
import type { BuyerMarket, Currency } from "../fees/types";

/**
 * A settle() call's inputs, frozen into a share URL. The FX rate is
 * captured at link-creation time and never re-fetched by the shared
 * page — see docs/plan-v0.3.html "Share URL format".
 */
export interface SharedBreakdown {
  grossPaidMinorUnits: number;
  payCurrency: Currency;
  buyerMarket: BuyerMarket;
  /** Absent iff payCurrency === ACCOUNT_CURRENCY. */
  fx?: { rate: number; asOf: string };
  /** SCHEDULE_EFFECTIVE_FROM at link-creation time, for drift detection. */
  scheduleAsOf: string;
  /**
   * The commercial fee, FX spread, and received amount as computed at
   * link-creation time. scheduleAsOf alone can't detect drift caused by
   * a calculation-methodology change that leaves the schedule date
   * untouched (see docs/plan-share-link-drift.html) — freezing the
   * actual outputs lets the shared page compare them against a fresh
   * recomputation instead. Absent on links created before this existed.
   */
  frozen?: {
    feeMinorUnits: number;
    netMinorUnits: number;
    /** Absent iff payCurrency === ACCOUNT_CURRENCY. */
    spreadMinorUnits?: number;
  };
}

export type DecodeResult =
  | { ok: true; value: SharedBreakdown }
  | { ok: false; reason: string };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateString(value: string): boolean {
  // Date.parse rolls an out-of-range day into the next month (e.g.
  // "2026-02-30" -> 2026-03-02) instead of rejecting it, so a regex +
  // Date.parse check alone would silently accept a nonexistent calendar
  // date. Re-render the parsed date and require it to match verbatim.
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Query params can repeat a key, yielding an array — take the first value. */
function firstValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

function parseNonNegativeIntParam(
  value: string | undefined,
  fieldName: string,
): { ok: true; value: number } | { ok: false; reason: string } {
  if (value === undefined || value.trim() === "") {
    return { ok: false, reason: `${fieldName} is missing` };
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return { ok: false, reason: `${fieldName} must be a non-negative integer` };
  }
  return { ok: true, value: parsed };
}

export function encodeBreakdownParams(input: SharedBreakdown): string {
  const params = new URLSearchParams({
    gross: String(input.grossPaidMinorUnits),
    cur: input.payCurrency,
    mkt: input.buyerMarket,
    sched: input.scheduleAsOf,
  });
  if (input.fx) {
    params.set("fx", String(input.fx.rate));
    params.set("on", input.fx.asOf);
  }
  if (input.frozen) {
    params.set("fee", String(input.frozen.feeMinorUnits));
    params.set("net", String(input.frozen.netMinorUnits));
    if (input.frozen.spreadMinorUnits !== undefined) {
      params.set("spread", String(input.frozen.spreadMinorUnits));
    }
  }
  return params.toString();
}

export function decodeBreakdownParams(
  raw: Record<string, string | string[] | undefined>,
): DecodeResult {
  const gross = firstValue(raw.gross);
  const cur = firstValue(raw.cur);
  const mkt = firstValue(raw.mkt);
  const fx = firstValue(raw.fx);
  const on = firstValue(raw.on);
  const sched = firstValue(raw.sched);
  const fee = firstValue(raw.fee);
  const net = firstValue(raw.net);
  const spread = firstValue(raw.spread);

  const grossResult = parseNonNegativeIntParam(gross, "gross");
  if (!grossResult.ok) return grossResult;
  const grossPaidMinorUnits = grossResult.value;

  if (cur === undefined) return { ok: false, reason: "cur is missing" };
  if (!isCurrency(cur)) {
    return {
      ok: false,
      reason: `cur must be one of ${CURRENCIES.map((c) => c.code).join(", ")}`,
    };
  }

  if (mkt === undefined) return { ok: false, reason: "mkt is missing" };
  if (!isBuyerMarket(mkt)) {
    return { ok: false, reason: `mkt must be one of ${BUYER_MARKETS.join(", ")}` };
  }

  if (sched === undefined) return { ok: false, reason: "sched is missing" };
  if (!isValidDateString(sched)) return { ok: false, reason: "sched must be a YYYY-MM-DD date" };

  // The frozen {fee, net, spread} group is optional (absent on pre-fix
  // links) but validated atomically when present: fee/net travel
  // together, and spread is coupled to cur exactly as fx/on are below.
  const feeProvided = fee !== undefined && fee.trim() !== "";
  const netProvided = net !== undefined && net.trim() !== "";
  const spreadProvided = spread !== undefined && spread.trim() !== "";

  if (feeProvided !== netProvided) {
    return { ok: false, reason: "fee and net must both be present or both be absent" };
  }

  let frozen: SharedBreakdown["frozen"];
  if (feeProvided && netProvided) {
    const feeResult = parseNonNegativeIntParam(fee, "fee");
    if (!feeResult.ok) return feeResult;
    const netResult = parseNonNegativeIntParam(net, "net");
    if (!netResult.ok) return netResult;

    if (cur === ACCOUNT_CURRENCY) {
      if (spreadProvided) {
        return { ok: false, reason: `spread must be absent when cur is ${ACCOUNT_CURRENCY}` };
      }
      frozen = { feeMinorUnits: feeResult.value, netMinorUnits: netResult.value };
    } else {
      if (!spreadProvided) {
        return { ok: false, reason: "spread is required when cur is not USD and fee/net are present" };
      }
      const spreadResult = parseNonNegativeIntParam(spread, "spread");
      if (!spreadResult.ok) return spreadResult;
      frozen = {
        feeMinorUnits: feeResult.value,
        netMinorUnits: netResult.value,
        spreadMinorUnits: spreadResult.value,
      };
    }
  } else if (spreadProvided) {
    return { ok: false, reason: "spread must be absent when fee and net are absent" };
  }

  if (cur === ACCOUNT_CURRENCY) {
    if (fx !== undefined || on !== undefined) {
      return { ok: false, reason: `fx and on must be absent when cur is ${ACCOUNT_CURRENCY}` };
    }
    return {
      ok: true,
      value: {
        grossPaidMinorUnits,
        payCurrency: cur,
        buyerMarket: mkt,
        scheduleAsOf: sched,
        ...(frozen ? { frozen } : {}),
      },
    };
  }

  if (fx === undefined) return { ok: false, reason: "fx is required when cur is not USD" };
  const rate = Number(fx);
  if (!Number.isFinite(rate) || rate <= 0) {
    return { ok: false, reason: "fx must be a positive, finite number" };
  }
  if (on === undefined) return { ok: false, reason: "on is required when cur is not USD" };
  if (!isValidDateString(on)) return { ok: false, reason: "on must be a YYYY-MM-DD date" };

  return {
    ok: true,
    value: {
      grossPaidMinorUnits,
      payCurrency: cur,
      buyerMarket: mkt,
      fx: { rate, asOf: on },
      scheduleAsOf: sched,
      ...(frozen ? { frozen } : {}),
    },
  };
}
