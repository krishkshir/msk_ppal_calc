import { ACCOUNT_CURRENCY } from "../fees/schedule";
import type { BuyerMarket, Currency } from "../fees/types";

/**
 * A settle() call's inputs, frozen into a share URL. The FX rate is
 * captured at link-creation time and never re-fetched by the shared
 * page — see docs/plan-v0.3.html "Share URL format".
 */
export interface SharedBreakdown {
  grossPaidCents: number;
  payCurrency: Currency;
  buyerMarket: BuyerMarket;
  /** Absent iff payCurrency === ACCOUNT_CURRENCY. */
  fx?: { rate: number; asOf: string };
  /** SCHEDULE_EFFECTIVE_FROM at link-creation time, for drift detection. */
  scheduleAsOf: string;
}

export type DecodeResult =
  | { ok: true; value: SharedBreakdown }
  | { ok: false; reason: string };

const CURRENCIES: readonly Currency[] = ["USD", "CAD"];
const BUYER_MARKETS: readonly BuyerMarket[] = ["UAE", "EEA_UK", "OTHER"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isCurrency(value: string): value is Currency {
  return (CURRENCIES as string[]).includes(value);
}

function isBuyerMarket(value: string): value is BuyerMarket {
  return (BUYER_MARKETS as string[]).includes(value);
}

function isValidDateString(value: string): boolean {
  return DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

/** Query params can repeat a key, yielding an array — take the first value. */
function firstValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

export function encodeBreakdownParams(input: SharedBreakdown): string {
  const params = new URLSearchParams({
    gross: String(input.grossPaidCents),
    cur: input.payCurrency,
    mkt: input.buyerMarket,
    sched: input.scheduleAsOf,
  });
  if (input.fx) {
    params.set("fx", String(input.fx.rate));
    params.set("on", input.fx.asOf);
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

  if (gross === undefined) return { ok: false, reason: "gross is missing" };
  const grossPaidCents = Number(gross);
  if (!Number.isInteger(grossPaidCents) || grossPaidCents < 0) {
    return { ok: false, reason: "gross must be a non-negative integer" };
  }

  if (cur === undefined) return { ok: false, reason: "cur is missing" };
  if (!isCurrency(cur)) return { ok: false, reason: `cur must be one of ${CURRENCIES.join(", ")}` };

  if (mkt === undefined) return { ok: false, reason: "mkt is missing" };
  if (!isBuyerMarket(mkt)) {
    return { ok: false, reason: `mkt must be one of ${BUYER_MARKETS.join(", ")}` };
  }

  if (sched === undefined) return { ok: false, reason: "sched is missing" };
  if (!isValidDateString(sched)) return { ok: false, reason: "sched must be a YYYY-MM-DD date" };

  if (cur === ACCOUNT_CURRENCY) {
    if (fx !== undefined || on !== undefined) {
      return { ok: false, reason: `fx and on must be absent when cur is ${ACCOUNT_CURRENCY}` };
    }
    return {
      ok: true,
      value: { grossPaidCents, payCurrency: cur, buyerMarket: mkt, scheduleAsOf: sched },
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
      grossPaidCents,
      payCurrency: cur,
      buyerMarket: mkt,
      fx: { rate, asOf: on },
      scheduleAsOf: sched,
    },
  };
}
