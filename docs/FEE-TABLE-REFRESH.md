# Fee table refresh checklist

`docs/plan.html` § "Maintenance contract" commits this project to a
quarterly review of the fee tables against PayPal's published schedule.
`src/lib/fees/schedule.ts` tracks that commitment in code —
`SCHEDULE_LAST_REVIEWED_ON` and `REVIEW_INTERVAL_DAYS` (92 days) —
and `isScheduleReviewOverdue()` drives a visible warning on the
calculator (`src/app/page.tsx`) once a review is overdue. This document
is the checklist for actually doing that review.

## 1. Re-read the two PayPal source pages

- [PayPal UAE merchant fees](https://www.paypal.com/ae/webapps/mpp/merchant-fees)
  — market rates (UAE domestic, EEA & UK, all-other-markets volume tiers)
  and the currency-conversion spread.
- [PayPal Business fees (AE)](https://www.paypal.com/ae/business/paypal-business-fees)
  — the per-currency fixed-fee table.

Note each page's own "last updated" date — that becomes the new
`SCHEDULE_EFFECTIVE_FROM` (and `FIXED_FEE_EFFECTIVE_FROM` in
`currencies.ts`) if either page changed since the last review.

## 2. Diff against what's in code

- **Market rates** — `SCHEDULE` in `src/lib/fees/schedule.ts`. Ms. K's
  practical rate is always the `OTHER` $0–$3,000 tier (she doesn't
  qualify for merchant-tier volume discounts — CONSTITUTION.md "Open
  questions"), so that row matters most; the three higher `OTHER` tiers
  and the `UAE`/`EEA_UK` rows are lower priority but still worth
  checking.
- **Per-currency fixed fees** — `CURRENCIES` in
  `src/lib/fees/currencies.ts`. Compare every non-USD row against the
  published table verbatim. **Never touch the USD row's $0.31** without
  a new observed transaction that contradicts it — that figure is
  ground truth (T1–T3), not a published lookup, and it deliberately
  overrides PayPal's own published $0.30.
- **The currency-conversion spread** — `FX_SPREAD_RATE` in
  `schedule.ts` (currently 4.0%, the published Middle East & Africa
  region rate).

If a rate or fee changed, update the constant/table entry, its
`sourceUrl` if the URL moved, and its `effectiveFrom` date. Leave
`confidence` as `"unvalidated"` unless a new observed transaction
justifies `"observed"` — see step 3.

## 3. If a new real transaction is provided

Append it, don't replace the existing table:

1. Add the transaction to `docs/CONSTITUTION.md` § "Observed
   transactions (ground truth)" (or, for a non-USD transaction, a new
   equivalent section — none exist yet) and mirror the same addition
   into `docs/plan.html`, which is kept in sync by design.
2. Reconcile the derived rate/fixed-fee model against the new point,
   the same way the original 4.40% error was caught — see
   CONSTITUTION.md's regression-and-validation writeup for the method.
3. Add a named regression test in `src/lib/fees/engine.test.ts`
   (`describe("settle — named regression cases ...")`), following the
   existing T1/T2/T3 pattern.
4. If the reconciled figure changes an existing constant, update it and
   flip the relevant `confidence` to `"observed"`.

## 4. Check standing manual overrides

If v0.6's rates-and-fees table (`docs/plan-v0.6.html`) is implemented:
review every active row in `fee_overrides` on `/ledger` against what you
just re-read from PayPal's pages. An override that now matches the
published figure again should be cleared, not left standing — a
stale-but-matching override still shows as `"manual"` confidence and
masks the real source. An override that still diverges (a genuine,
ongoing correction) should stay, but confirm its `note` still explains
why.

## 5. Bump the review date

Once the diff is done (whether or not anything changed), update
`SCHEDULE_LAST_REVIEWED_ON` in `src/lib/fees/schedule.ts` to today's
date. This is what clears the staleness warning — it must be bumped
even on a review that finds no changes, since it records that a human
looked, not that a number moved.

## 6. Update the docs in the same change

Per `CLAUDE.md` § "Before pushing to remote": update
`docs/CONSTITUTION.md`, `docs/plan.html`, `docs/CHANGELOG.md`, and
`CLAUDE.md` itself so they reflect what's actually true after the
review, in the same push — not a follow-up.
