import { ACCOUNT_CURRENCY } from "@/lib/fees/schedule";
import type { Currency } from "@/lib/fees/types";

const FRANKFURTER_BASE_URL = "https://api.frankfurter.dev/v2/rates";

export interface FxRate {
  /** Units of USD per 1 unit of payCurrency — the shape engine.ts's fxBaseRateToUSD expects. */
  rate: number;
  /** The date Frankfurter's ECB-sourced rate is valid as of, e.g. "2026-08-10". */
  asOf: string;
}

interface FrankfurterEntry {
  date: string;
  base: string;
  quote: string;
  rate: number;
}

/**
 * Fetches the base (pre-spread) market rate for converting payCurrency to
 * USD, from Frankfurter — isolated from src/lib/fees/engine.ts, which never
 * fetches on its own (CONSTITUTION.md "the fee engine is pure and
 * isolated"). Requesting base=payCurrency&quotes=USD returns the rate
 * already in the units the engine wants (USD per 1 unit of payCurrency),
 * with no inversion needed.
 *
 * `date` (YYYY-MM-DD) requests the historical rate for that day instead of
 * the latest — needed by the v0.5 ledger, where a recorded transaction's
 * FX rate must be the rate on its payment date, not today's (see
 * docs/plan-v0.5.html "FX needs a transaction's own date, not today's").
 * ECB, Frankfurter's source, publishes business days only — the response's
 * own `asOf` may therefore precede the requested date, and callers should
 * surface that gap rather than assume an exact match.
 */
export async function getFxRateToUSD(
  payCurrency: Exclude<Currency, typeof ACCOUNT_CURRENCY>,
  date?: string,
): Promise<FxRate> {
  const url = date
    ? `${FRANKFURTER_BASE_URL}?date=${date}&base=${payCurrency}&quotes=USD`
    : `${FRANKFURTER_BASE_URL}?base=${payCurrency}&quotes=USD`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Frankfurter request failed (${response.status} ${response.statusText}) for ${payCurrency}→USD`,
    );
  }

  const body: unknown = await response.json();
  const entry = Array.isArray(body)
    ? (body as FrankfurterEntry[]).find((e) => e.base === payCurrency && e.quote === "USD")
    : undefined;

  if (!entry || typeof entry.rate !== "number" || typeof entry.date !== "string") {
    throw new Error(`Unexpected Frankfurter response shape for ${payCurrency}→USD`);
  }

  return { rate: entry.rate, asOf: entry.date };
}
