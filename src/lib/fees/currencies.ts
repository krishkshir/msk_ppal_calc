/**
 * How trustworthy a figure is, per CONSTITUTION.md's "estimates are
 * labeled as estimates" principle:
 * - observed: matches a real, completed transaction
 * - estimated: a documented assumption standing in for missing data
 * - unvalidated: sourced from a published table or third-party tool,
 *   never checked against a real transaction
 */
export type Confidence = "observed" | "estimated" | "unvalidated";

export interface CurrencySpec {
  code: string;
  label: string;
  /**
   * ISO 4217 minor-unit exponent — how many digits after the decimal
   * point this currency uses. Every currency here is 2 except JPY (0),
   * which has no minor decimal unit at all.
   */
  minorUnitExponent: 0 | 2;
  /**
   * PayPal's fixed fee for this currency, in minor units — cents for a
   * 2-exponent currency, whole yen for JPY.
   */
  fixedFeeMinorUnits: number;
  confidence: Confidence;
  effectiveFrom: string;
  sourceUrl: string;
  note?: string;
}

const PAYPAL_BUSINESS_FEES_SOURCE_URL =
  "https://www.paypal.com/ae/business/paypal-business-fees";
const OBSERVED_TRANSACTIONS_SOURCE =
  "../docs/CONSTITUTION.md#observed-transactions-ground-truth";
const FIXED_FEE_EFFECTIVE_FROM = "2026-05-28";

/**
 * PayPal's own published USD fixed fee — refuted by three real
 * transactions (T1-T3, CONSTITUTION.md "Observed transactions"), which
 * jointly reproduce exactly at $0.31, not $0.30. Kept here, unused
 * below, so the refutation stays visible in code, not just in the docs.
 */
export const PUBLISHED_USD_FIXED_FEE_MINOR_UNITS = 30;

const UNVALIDATED_FIXED_FEE_NOTE =
  "PayPal's published fixed fee, taken verbatim from paypal.com/ae/business/paypal-business-fees. " +
  "Not scaled by the USD observed/published ratio (1.033) — that would invent data no " +
  "transaction has confirmed. Unvalidated by observation (CONSTITUTION.md open question #1).";

/**
 * Currencies this engine can settle or quote in — every currency that
 * appears in both PayPal's published fixed-fee table and Frankfurter's
 * rate list (docs/plan-v0.4.html "Scope"). TWD and RUB are in PayPal's
 * table but Frankfurter/ECB has no rate for either, so neither could
 * ever be settled or quoted regardless of the fixed-fee entry.
 */
export const CURRENCIES = [
  {
    code: "USD",
    label: "US Dollar",
    minorUnitExponent: 2,
    fixedFeeMinorUnits: 31,
    confidence: "observed",
    effectiveFrom: FIXED_FEE_EFFECTIVE_FROM,
    sourceUrl: OBSERVED_TRANSACTIONS_SOURCE,
    note:
      "PayPal publishes $0.30; three real transactions (T1-T3) refute it — " +
      "$0.31 is the figure that reproduces all three exactly.",
  },
  {
    code: "CAD",
    label: "Canadian Dollar",
    minorUnitExponent: 2,
    fixedFeeMinorUnits: 30,
    confidence: "unvalidated",
    effectiveFrom: FIXED_FEE_EFFECTIVE_FROM,
    sourceUrl: PAYPAL_BUSINESS_FEES_SOURCE_URL,
    note: UNVALIDATED_FIXED_FEE_NOTE,
  },
  {
    code: "EUR",
    label: "Euro",
    minorUnitExponent: 2,
    fixedFeeMinorUnits: 35,
    confidence: "unvalidated",
    effectiveFrom: FIXED_FEE_EFFECTIVE_FROM,
    sourceUrl: PAYPAL_BUSINESS_FEES_SOURCE_URL,
    note: UNVALIDATED_FIXED_FEE_NOTE,
  },
  {
    code: "GBP",
    label: "British Pound",
    minorUnitExponent: 2,
    fixedFeeMinorUnits: 20,
    confidence: "unvalidated",
    effectiveFrom: FIXED_FEE_EFFECTIVE_FROM,
    sourceUrl: PAYPAL_BUSINESS_FEES_SOURCE_URL,
    note: UNVALIDATED_FIXED_FEE_NOTE,
  },
  {
    code: "CHF",
    label: "Swiss Franc",
    minorUnitExponent: 2,
    fixedFeeMinorUnits: 55,
    confidence: "unvalidated",
    effectiveFrom: FIXED_FEE_EFFECTIVE_FROM,
    sourceUrl: PAYPAL_BUSINESS_FEES_SOURCE_URL,
    note: UNVALIDATED_FIXED_FEE_NOTE,
  },
  {
    code: "AUD",
    label: "Australian Dollar",
    minorUnitExponent: 2,
    fixedFeeMinorUnits: 30,
    confidence: "unvalidated",
    effectiveFrom: FIXED_FEE_EFFECTIVE_FROM,
    sourceUrl: PAYPAL_BUSINESS_FEES_SOURCE_URL,
    note: UNVALIDATED_FIXED_FEE_NOTE,
  },
  {
    code: "NZD",
    label: "New Zealand Dollar",
    minorUnitExponent: 2,
    fixedFeeMinorUnits: 45,
    confidence: "unvalidated",
    effectiveFrom: FIXED_FEE_EFFECTIVE_FROM,
    sourceUrl: PAYPAL_BUSINESS_FEES_SOURCE_URL,
    note: UNVALIDATED_FIXED_FEE_NOTE,
  },
  {
    code: "SGD",
    label: "Singapore Dollar",
    minorUnitExponent: 2,
    fixedFeeMinorUnits: 50,
    confidence: "unvalidated",
    effectiveFrom: FIXED_FEE_EFFECTIVE_FROM,
    sourceUrl: PAYPAL_BUSINESS_FEES_SOURCE_URL,
    note: UNVALIDATED_FIXED_FEE_NOTE,
  },
  {
    code: "HKD",
    label: "Hong Kong Dollar",
    minorUnitExponent: 2,
    fixedFeeMinorUnits: 235,
    confidence: "unvalidated",
    effectiveFrom: FIXED_FEE_EFFECTIVE_FROM,
    sourceUrl: PAYPAL_BUSINESS_FEES_SOURCE_URL,
    note: UNVALIDATED_FIXED_FEE_NOTE,
  },
  {
    code: "JPY",
    label: "Japanese Yen",
    minorUnitExponent: 0,
    fixedFeeMinorUnits: 40,
    confidence: "unvalidated",
    effectiveFrom: FIXED_FEE_EFFECTIVE_FROM,
    sourceUrl: PAYPAL_BUSINESS_FEES_SOURCE_URL,
    note: UNVALIDATED_FIXED_FEE_NOTE,
  },
  {
    code: "SEK",
    label: "Swedish Krona",
    minorUnitExponent: 2,
    fixedFeeMinorUnits: 325,
    confidence: "unvalidated",
    effectiveFrom: FIXED_FEE_EFFECTIVE_FROM,
    sourceUrl: PAYPAL_BUSINESS_FEES_SOURCE_URL,
    note: UNVALIDATED_FIXED_FEE_NOTE,
  },
  {
    code: "NOK",
    label: "Norwegian Krone",
    minorUnitExponent: 2,
    fixedFeeMinorUnits: 280,
    confidence: "unvalidated",
    effectiveFrom: FIXED_FEE_EFFECTIVE_FROM,
    sourceUrl: PAYPAL_BUSINESS_FEES_SOURCE_URL,
    note: UNVALIDATED_FIXED_FEE_NOTE,
  },
  {
    code: "DKK",
    label: "Danish Krone",
    minorUnitExponent: 2,
    fixedFeeMinorUnits: 260,
    confidence: "unvalidated",
    effectiveFrom: FIXED_FEE_EFFECTIVE_FROM,
    sourceUrl: PAYPAL_BUSINESS_FEES_SOURCE_URL,
    note: UNVALIDATED_FIXED_FEE_NOTE,
  },
  {
    code: "PLN",
    label: "Polish Zloty",
    minorUnitExponent: 2,
    fixedFeeMinorUnits: 135,
    confidence: "unvalidated",
    effectiveFrom: FIXED_FEE_EFFECTIVE_FROM,
    sourceUrl: PAYPAL_BUSINESS_FEES_SOURCE_URL,
    note: UNVALIDATED_FIXED_FEE_NOTE,
  },
  {
    code: "CZK",
    label: "Czech Koruna",
    minorUnitExponent: 2,
    fixedFeeMinorUnits: 1000,
    confidence: "unvalidated",
    effectiveFrom: FIXED_FEE_EFFECTIVE_FROM,
    sourceUrl: PAYPAL_BUSINESS_FEES_SOURCE_URL,
    note: UNVALIDATED_FIXED_FEE_NOTE,
  },
  {
    code: "HUF",
    label: "Hungarian Forint",
    minorUnitExponent: 2,
    fixedFeeMinorUnits: 9000,
    confidence: "unvalidated",
    effectiveFrom: FIXED_FEE_EFFECTIVE_FROM,
    sourceUrl: PAYPAL_BUSINESS_FEES_SOURCE_URL,
    note: UNVALIDATED_FIXED_FEE_NOTE,
  },
  {
    code: "ILS",
    label: "Israeli New Shekel",
    minorUnitExponent: 2,
    fixedFeeMinorUnits: 120,
    confidence: "unvalidated",
    effectiveFrom: FIXED_FEE_EFFECTIVE_FROM,
    sourceUrl: PAYPAL_BUSINESS_FEES_SOURCE_URL,
    note: UNVALIDATED_FIXED_FEE_NOTE,
  },
  {
    code: "MXN",
    label: "Mexican Peso",
    minorUnitExponent: 2,
    fixedFeeMinorUnits: 400,
    confidence: "unvalidated",
    effectiveFrom: FIXED_FEE_EFFECTIVE_FROM,
    sourceUrl: PAYPAL_BUSINESS_FEES_SOURCE_URL,
    note: UNVALIDATED_FIXED_FEE_NOTE,
  },
  {
    code: "BRL",
    label: "Brazilian Real",
    minorUnitExponent: 2,
    fixedFeeMinorUnits: 60,
    confidence: "unvalidated",
    effectiveFrom: FIXED_FEE_EFFECTIVE_FROM,
    sourceUrl: PAYPAL_BUSINESS_FEES_SOURCE_URL,
    note: UNVALIDATED_FIXED_FEE_NOTE,
  },
  {
    code: "MYR",
    label: "Malaysian Ringgit",
    minorUnitExponent: 2,
    fixedFeeMinorUnits: 200,
    confidence: "unvalidated",
    effectiveFrom: FIXED_FEE_EFFECTIVE_FROM,
    sourceUrl: PAYPAL_BUSINESS_FEES_SOURCE_URL,
    note: UNVALIDATED_FIXED_FEE_NOTE,
  },
  {
    code: "PHP",
    label: "Philippine Peso",
    minorUnitExponent: 2,
    fixedFeeMinorUnits: 1500,
    confidence: "unvalidated",
    effectiveFrom: FIXED_FEE_EFFECTIVE_FROM,
    sourceUrl: PAYPAL_BUSINESS_FEES_SOURCE_URL,
    note: UNVALIDATED_FIXED_FEE_NOTE,
  },
  {
    code: "THB",
    label: "Thai Baht",
    minorUnitExponent: 2,
    fixedFeeMinorUnits: 1100,
    confidence: "unvalidated",
    effectiveFrom: FIXED_FEE_EFFECTIVE_FROM,
    sourceUrl: PAYPAL_BUSINESS_FEES_SOURCE_URL,
    note: UNVALIDATED_FIXED_FEE_NOTE,
  },
] as const satisfies readonly CurrencySpec[];

export type Currency = (typeof CURRENCIES)[number]["code"];

export function currencySpec(code: Currency): CurrencySpec {
  const spec = CURRENCIES.find((c) => c.code === code);
  if (!spec) {
    throw new Error(`No currency spec for ${code}`);
  }
  return spec;
}

export function isCurrency(value: string): value is Currency {
  return CURRENCIES.some((c) => c.code === value);
}
