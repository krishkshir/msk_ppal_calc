export type { Currency, Confidence } from "./currencies";
export type { BuyerMarket } from "./markets";

import type { Confidence, Currency } from "./currencies";

export interface Money {
  currency: Currency;
  minorUnits: number;
}

export interface FeeLineItem {
  label: string;
  minorUnits: number;
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
