/**
 * Where a rate or fee figure came from — orthogonal to Confidence
 * (currencies.ts), which says how much to trust it. A figure can be
 * "published" (PayPal's own page) and still "unvalidated" (never checked
 * against a real transaction), or "derived" (computed by this app from
 * T1-T3 or the ledger) and "observed". See docs/plan-v0.6.html "Origin,
 * as data."
 */
export type SourceKind = "published" | "third-party" | "derived" | "manual";

export interface FeeSource {
  kind: SourceKind;
  label: string;
  url?: string;
}

export const FEE_SOURCES = {
  paypalMerchantFees: {
    kind: "published",
    label: "PayPal — UAE merchant fees",
    url: "https://www.paypal.com/ae/webapps/mpp/merchant-fees",
  },
  paypalBusinessFees: {
    kind: "published",
    label: "PayPal — Business fees (AE)",
    url: "https://www.paypal.com/ae/business/paypal-business-fees",
  },
  designhillCalculator: {
    kind: "third-party",
    label: "designhill.com PayPal fee calculator",
    url: "https://www.designhill.com/tools/paypal-fee-calculator",
  },
  observedTransactions: {
    kind: "derived",
    label: "Computed by this app from T1–T3",
    url: "https://github.com/krishkshir/msk_ppal_calc/blob/main/docs/CONSTITUTION.md#observed-transactions-ground-truth",
  },
  ledgerModel: {
    kind: "derived",
    label: "Computed by this app from your ledger",
  },
  manualOverride: {
    kind: "manual",
    label: "Manual override",
  },
} as const satisfies Record<string, FeeSource>;

export type FeeSourceId = keyof typeof FEE_SOURCES;

export function feeSource(id: FeeSourceId): FeeSource {
  return FEE_SOURCES[id];
}
