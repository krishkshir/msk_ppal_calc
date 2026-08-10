/**
 * Buyer's market, per PayPal's UAE merchant fee schedule (CONSTITUTION.md
 * "The current UAE fee schedule"). "OTHER" covers everywhere outside the
 * UAE and EEA/UK, including the US and Canada, and is itself tiered by
 * trailing monthly volume in schedule.ts.
 */
export type BuyerMarket = "UAE" | "EEA_UK" | "OTHER";

/**
 * Currencies this engine can settle or quote in. Deliberately small:
 * only USD (the account currency) and CAD (the README's Canadian
 * scenario) are exercised in v0.1. Broader coverage is v0.4 per the
 * roadmap in CONSTITUTION.md.
 */
export type Currency = "USD" | "CAD";

/**
 * How trustworthy a figure is, per CONSTITUTION.md's "estimates are
 * labeled as estimates" principle:
 * - observed: matches a real, completed transaction
 * - estimated: a documented assumption standing in for missing data
 * - unvalidated: sourced from a published table or third-party tool,
 *   never checked against a real transaction
 */
export type Confidence = "observed" | "estimated" | "unvalidated";

export interface Money {
  currency: Currency;
  cents: number;
}

export interface FeeLineItem {
  label: string;
  cents: number;
  currency: Currency;
  confidence: Confidence;
  note?: string;
}

export interface Breakdown {
  grossPaid: Money;
  commercialFee: FeeLineItem;
  fxConversion: FeeLineItem | null;
  received: Money;
  ratesAsOf: string;
}
