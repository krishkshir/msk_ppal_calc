import type { Currency } from "./currencies";

/**
 * Buyer's market, per PayPal's UAE merchant fee schedule (CONSTITUTION.md
 * "The current UAE fee schedule"). "OTHER" covers everywhere outside the
 * UAE and EEA/UK, including the US and Canada, and is itself tiered by
 * trailing monthly volume in schedule.ts.
 */
export const BUYER_MARKETS = ["UAE", "EEA_UK", "OTHER"] as const;
export type BuyerMarket = (typeof BUYER_MARKETS)[number];

export function isBuyerMarket(value: string): value is BuyerMarket {
  return (BUYER_MARKETS as readonly string[]).includes(value);
}

export interface CountrySpec {
  /** ISO 3166-1 alpha-2, except "OTHER_NOT_LISTED" for the catch-all entry. */
  code: string;
  name: string;
  market: BuyerMarket;
  /** Pre-filled when this country is selected; the currency picker stays independently overridable. */
  defaultCurrency: Currency;
}

/**
 * Country -> PayPal market bucket, so Ms. K picks a country instead of
 * classifying markets herself (docs/plan-v0.4.html "Country picker for
 * buyer market"). Switzerland is deliberately mapped to OTHER, not
 * EEA_UK — it's in EFTA, not the EEA, exactly the classification trap
 * this picker exists to prevent. Countries whose usual currency isn't in
 * CURRENCIES (Bulgaria/BGN, Romania/RON, Iceland/ISK) default to USD
 * rather than a fabricated currency.
 */
export const COUNTRIES: CountrySpec[] = [
  { code: "AE", name: "United Arab Emirates", market: "UAE", defaultCurrency: "USD" },

  // EEA + UK
  { code: "AT", name: "Austria", market: "EEA_UK", defaultCurrency: "EUR" },
  { code: "BE", name: "Belgium", market: "EEA_UK", defaultCurrency: "EUR" },
  { code: "BG", name: "Bulgaria", market: "EEA_UK", defaultCurrency: "USD" },
  { code: "HR", name: "Croatia", market: "EEA_UK", defaultCurrency: "EUR" },
  { code: "CY", name: "Cyprus", market: "EEA_UK", defaultCurrency: "EUR" },
  { code: "CZ", name: "Czechia", market: "EEA_UK", defaultCurrency: "CZK" },
  { code: "DK", name: "Denmark", market: "EEA_UK", defaultCurrency: "DKK" },
  { code: "EE", name: "Estonia", market: "EEA_UK", defaultCurrency: "EUR" },
  { code: "FI", name: "Finland", market: "EEA_UK", defaultCurrency: "EUR" },
  { code: "FR", name: "France", market: "EEA_UK", defaultCurrency: "EUR" },
  { code: "DE", name: "Germany", market: "EEA_UK", defaultCurrency: "EUR" },
  { code: "GR", name: "Greece", market: "EEA_UK", defaultCurrency: "EUR" },
  { code: "HU", name: "Hungary", market: "EEA_UK", defaultCurrency: "HUF" },
  { code: "IS", name: "Iceland", market: "EEA_UK", defaultCurrency: "USD" },
  { code: "IE", name: "Ireland", market: "EEA_UK", defaultCurrency: "EUR" },
  { code: "IT", name: "Italy", market: "EEA_UK", defaultCurrency: "EUR" },
  { code: "LV", name: "Latvia", market: "EEA_UK", defaultCurrency: "EUR" },
  { code: "LI", name: "Liechtenstein", market: "EEA_UK", defaultCurrency: "CHF" },
  { code: "LT", name: "Lithuania", market: "EEA_UK", defaultCurrency: "EUR" },
  { code: "LU", name: "Luxembourg", market: "EEA_UK", defaultCurrency: "EUR" },
  { code: "MT", name: "Malta", market: "EEA_UK", defaultCurrency: "EUR" },
  { code: "NL", name: "Netherlands", market: "EEA_UK", defaultCurrency: "EUR" },
  { code: "NO", name: "Norway", market: "EEA_UK", defaultCurrency: "NOK" },
  { code: "PL", name: "Poland", market: "EEA_UK", defaultCurrency: "PLN" },
  { code: "PT", name: "Portugal", market: "EEA_UK", defaultCurrency: "EUR" },
  { code: "RO", name: "Romania", market: "EEA_UK", defaultCurrency: "USD" },
  { code: "SK", name: "Slovakia", market: "EEA_UK", defaultCurrency: "EUR" },
  { code: "SI", name: "Slovenia", market: "EEA_UK", defaultCurrency: "EUR" },
  { code: "ES", name: "Spain", market: "EEA_UK", defaultCurrency: "EUR" },
  { code: "SE", name: "Sweden", market: "EEA_UK", defaultCurrency: "SEK" },
  { code: "GB", name: "United Kingdom", market: "EEA_UK", defaultCurrency: "GBP" },

  // Representative countries for the remaining supported currencies — "OTHER" market
  { code: "US", name: "United States", market: "OTHER", defaultCurrency: "USD" },
  { code: "CA", name: "Canada", market: "OTHER", defaultCurrency: "CAD" },
  // Switzerland is EFTA, not EEA — deliberately OTHER, not EEA_UK. See
  // this file's module doc comment.
  { code: "CH", name: "Switzerland", market: "OTHER", defaultCurrency: "CHF" },
  { code: "AU", name: "Australia", market: "OTHER", defaultCurrency: "AUD" },
  { code: "NZ", name: "New Zealand", market: "OTHER", defaultCurrency: "NZD" },
  { code: "SG", name: "Singapore", market: "OTHER", defaultCurrency: "SGD" },
  { code: "HK", name: "Hong Kong", market: "OTHER", defaultCurrency: "HKD" },
  { code: "JP", name: "Japan", market: "OTHER", defaultCurrency: "JPY" },
  { code: "IL", name: "Israel", market: "OTHER", defaultCurrency: "ILS" },
  { code: "MX", name: "Mexico", market: "OTHER", defaultCurrency: "MXN" },
  { code: "BR", name: "Brazil", market: "OTHER", defaultCurrency: "BRL" },
  { code: "MY", name: "Malaysia", market: "OTHER", defaultCurrency: "MYR" },
  { code: "PH", name: "Philippines", market: "OTHER", defaultCurrency: "PHP" },
  { code: "TH", name: "Thailand", market: "OTHER", defaultCurrency: "THB" },

  { code: "OTHER_NOT_LISTED", name: "Other / not listed", market: "OTHER", defaultCurrency: "USD" },
];

export function countrySpec(code: string): CountrySpec {
  const spec = COUNTRIES.find((c) => c.code === code);
  if (!spec) {
    throw new Error(`No country spec for ${code}`);
  }
  return spec;
}

export function marketForCountry(countryCode: string): BuyerMarket {
  return countrySpec(countryCode).market;
}
