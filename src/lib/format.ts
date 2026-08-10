import type { Currency } from "@/lib/fees/types";

/** Parses a dollar-amount string from a form field into integer cents. Returns null if not a valid non-negative amount. */
export function parseDollarsToCents(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

const AMOUNT_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formats cents as "CAD 1,000.00" — currency code prefix, not a symbol, so USD/CAD are never ambiguous. */
export function formatMoney(cents: number, currency: Currency): string {
  return `${currency} ${AMOUNT_FORMATTER.format(cents / 100)}`;
}

/** Formats cents as "1,000.00", no currency code — for use next to a currency already shown once. */
export function formatAmount(cents: number): string {
  return AMOUNT_FORMATTER.format(cents / 100);
}
