import type { Confidence } from "./currencies";
import type { BuyerMarket } from "./markets";

/** Ms. K's PayPal account is UAE-registered, USD-denominated. */
export const ACCOUNT_CURRENCY = "USD" as const;

/**
 * PayPal's currency-conversion spread above the base market rate,
 * applied whenever the buyer pays in a currency other than the
 * account's (Middle East & Africa region rate). Unlike the commercial
 * transaction fee, this carries no ground truth — no observed
 * transaction involves a currency conversion — so every fxConversion
 * line item the engine produces is flagged "estimated".
 */
export const FX_SPREAD_RATE = 0.04;

/** Last-updated date on PayPal's published UAE merchant fee page. */
export const SCHEDULE_EFFECTIVE_FROM = "2026-05-28";

/**
 * The date this schedule (rates and tiers here, plus — since v0.4 — the
 * per-currency fixed-fee table in currencies.ts) was last checked
 * against PayPal's published fee pages. Distinct from
 * SCHEDULE_EFFECTIVE_FROM, which is PayPal's own "last updated" date on
 * that page: this is *our* review date, which can lag behind even when
 * PayPal's page hasn't changed, if nobody has looked. See
 * docs/FEE-TABLE-REFRESH.md.
 */
export const SCHEDULE_LAST_REVIEWED_ON = SCHEDULE_EFFECTIVE_FROM;

/** Quarterly, per docs/plan.html "Maintenance contract". */
export const REVIEW_INTERVAL_DAYS = 92;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * True once more than REVIEW_INTERVAL_DAYS have passed since the
 * schedule was last checked against PayPal's published pages — the
 * failure mode docs/plan.html's "Maintenance contract" warns is the one
 * that would quietly make this tool wrong again. See
 * docs/FEE-TABLE-REFRESH.md for the review checklist.
 */
export function isScheduleReviewOverdue(today: Date): boolean {
  const reviewedOn = new Date(SCHEDULE_LAST_REVIEWED_ON);
  const daysSinceReview = (today.getTime() - reviewedOn.getTime()) / MS_PER_DAY;
  return daysSinceReview > REVIEW_INTERVAL_DAYS;
}

const PAYPAL_SOURCE_URL = "https://www.paypal.com/ae/webapps/mpp/merchant-fees";
const DESIGNHILL_SOURCE_URL = "https://www.designhill.com/tools/paypal-fee-calculator";
const OBSERVED_TRANSACTIONS_SOURCE =
  "../docs/CONSTITUTION.md#observed-transactions-ground-truth";

export interface ScheduleEntry {
  buyerMarket: BuyerMarket;
  /** Inclusive lower bound, trailing monthly volume in USD cents. */
  minMonthlyVolumeUSDCents: number;
  /** Inclusive upper bound, or null for no upper bound. */
  maxMonthlyVolumeUSDCents: number | null;
  rate: number;
  confidence: Confidence;
  effectiveFrom: string;
  sourceUrl: string;
  note?: string;
}

const UNVALIDATED_TIER_NOTE =
  "Sourced only from designhill.com's tool, which does not ask for seller " +
  "country and may apply a generic/US-style table regardless of seller " +
  "location. Unvalidated by observation — the tier below it turned out to " +
  "be wrong.";

/**
 * Versioned rate table, keyed on buyerMarket and trailing monthly sales
 * volume — deliberately not on single-transaction size, correcting the
 * tiering bug in the calculator Ms. K uses today (CONSTITUTION.md
 * "Reconciling with Ms. K's current tool"). The fixed-fee component of
 * the commercial fee is looked up separately, by currency, in
 * currencies.ts — PayPal's fixed fee varies by currency, not by market
 * or volume tier.
 */
export const SCHEDULE: ScheduleEntry[] = [
  {
    buyerMarket: "UAE",
    minMonthlyVolumeUSDCents: 0,
    maxMonthlyVolumeUSDCents: null,
    rate: 0.034,
    confidence: "unvalidated",
    effectiveFrom: SCHEDULE_EFFECTIVE_FROM,
    sourceUrl: PAYPAL_SOURCE_URL,
    note: "Domestic UAE rate as published. No observed domestic transaction.",
  },
  {
    buyerMarket: "EEA_UK",
    minMonthlyVolumeUSDCents: 0,
    maxMonthlyVolumeUSDCents: null,
    rate: 0.0469,
    confidence: "unvalidated",
    effectiveFrom: SCHEDULE_EFFECTIVE_FROM,
    sourceUrl: PAYPAL_SOURCE_URL,
    note: "EEA/UK rate as published. No observed EEA/UK transaction.",
  },
  {
    buyerMarket: "OTHER",
    minMonthlyVolumeUSDCents: 0,
    maxMonthlyVolumeUSDCents: 300_000, // $3,000.00
    rate: 0.04625,
    confidence: "observed",
    effectiveFrom: SCHEDULE_EFFECTIVE_FROM,
    sourceUrl: OBSERVED_TRANSACTIONS_SOURCE,
    note:
      "PayPal publishes 4.40% for this tier; three real transactions " +
      "(T1-T3) refute it — 4.625% is the observed rate. See " +
      "CONSTITUTION.md 'Observed transactions'.",
  },
  {
    buyerMarket: "OTHER",
    minMonthlyVolumeUSDCents: 300_001, // $3,000.01
    maxMonthlyVolumeUSDCents: 1_000_000, // $10,000.00
    rate: 0.039,
    confidence: "unvalidated",
    effectiveFrom: SCHEDULE_EFFECTIVE_FROM,
    sourceUrl: DESIGNHILL_SOURCE_URL,
    note: UNVALIDATED_TIER_NOTE,
  },
  {
    buyerMarket: "OTHER",
    minMonthlyVolumeUSDCents: 1_000_001, // $10,000.01
    maxMonthlyVolumeUSDCents: 10_000_000, // $100,000.00
    rate: 0.037,
    confidence: "unvalidated",
    effectiveFrom: SCHEDULE_EFFECTIVE_FROM,
    sourceUrl: DESIGNHILL_SOURCE_URL,
    note: UNVALIDATED_TIER_NOTE,
  },
  {
    buyerMarket: "OTHER",
    minMonthlyVolumeUSDCents: 10_000_001, // above $100,000.00
    maxMonthlyVolumeUSDCents: null,
    rate: 0.034,
    confidence: "unvalidated",
    effectiveFrom: SCHEDULE_EFFECTIVE_FROM,
    sourceUrl: DESIGNHILL_SOURCE_URL,
    note: UNVALIDATED_TIER_NOTE,
  },
];

export function selectTier(
  buyerMarket: BuyerMarket,
  monthlyVolumeUSDCents: number,
): ScheduleEntry {
  const match = SCHEDULE.find(
    (entry) =>
      entry.buyerMarket === buyerMarket &&
      monthlyVolumeUSDCents >= entry.minMonthlyVolumeUSDCents &&
      (entry.maxMonthlyVolumeUSDCents === null ||
        monthlyVolumeUSDCents <= entry.maxMonthlyVolumeUSDCents),
  );
  if (!match) {
    throw new Error(
      `No fee schedule entry for buyerMarket=${buyerMarket}, ` +
        `monthlyVolumeUSDCents=${monthlyVolumeUSDCents}`,
    );
  }
  return match;
}
