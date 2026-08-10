import { currencySpec, type Currency } from "@/lib/fees/currencies";

const FORMATTERS: Record<0 | 2, Intl.NumberFormat> = {
  0: new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
  2: new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
};

/** Parses a decimal-amount string from a form field into integer minor units for the given currency. Returns null if not a valid non-negative amount. */
export function parseAmountToMinorUnits(input: string, currency: Currency): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  const { minorUnitExponent } = currencySpec(currency);
  return Math.round(value * 10 ** minorUnitExponent);
}

/** Formats minor units as "CAD 1,000.00" (or "JPY 1,000" for a zero-decimal currency) — currency code prefix, not a symbol, so currencies are never ambiguous. */
export function formatMoney(minorUnits: number, currency: Currency): string {
  const { minorUnitExponent } = currencySpec(currency);
  return `${currency} ${FORMATTERS[minorUnitExponent].format(minorUnits / 10 ** minorUnitExponent)}`;
}

/** Formats minor units as "1,000.00", no currency code — for use next to a currency already shown once. */
export function formatAmount(minorUnits: number, currency: Currency): string {
  const { minorUnitExponent } = currencySpec(currency);
  return FORMATTERS[minorUnitExponent].format(minorUnits / 10 ** minorUnitExponent);
}
