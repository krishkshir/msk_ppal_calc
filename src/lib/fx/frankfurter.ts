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
 */
export async function getFxRateToUSD(
  payCurrency: Exclude<Currency, typeof ACCOUNT_CURRENCY>,
): Promise<FxRate> {
  const url = `${FRANKFURTER_BASE_URL}?base=${payCurrency}&quotes=USD`;
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
