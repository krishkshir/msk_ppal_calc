# CONSTITUTION.md — msk_ppal_calc

## Mission

Ms. K runs a solo consulting business that accepts payments from clients anywhere
in the world over PayPal. Her account is **UAE-registered, USD-denominated**.
When a client pays her, PayPal deducts a transaction fee and, if the client paid
in a different currency, a currency-conversion spread — before the money ever
reaches her. Neither deduction is shown to the client.

That gap caused a real incident, quoted here verbatim from the request that
started this project:

> A new client from Canada finds it confusing cos it doesn't show him the
> transaction fee calculation but deducted it from me.
>
> And I'm not the best at this. Thought I would ask you if you had some concept
> or chart.

This project exists to close that gap. It has two jobs, not one:

1. **Help Ms. K quote correctly.** Given what she needs to net, tell her what to
   invoice — accounting for PayPal's fee and the FX spread — so she stops
   absorbing costs she didn't plan for.
2. **Make the deduction visible to the client.** Produce a breakdown Ms. K can
   share that shows exactly where the money went, so a shortfall reads as
   "PayPal's cut, itemized" instead of "she overcharged me."

This is a **calculator**, not a payment processor. It doesn't move money, store
client data, or talk to PayPal on Ms. K's behalf. It computes, and it explains.

---

## Why this is harder than it looks

PayPal's fee is not one number. For a UAE-registered account, it depends on
where the buyer is, and a second, separate cost — the currency-conversion
spread — applies whenever the buyer pays in a currency other than the account's.

### The current UAE fee schedule

Sourced from PayPal's own published merchant fee page
(`paypal.com/ae/webapps/mpp/merchant-fees`, last updated 2026-05-28):

| Component | Rate | Applies when |
|---|---|---|
| Commercial transaction — domestic | 3.40% + fixed fee | Buyer is in the UAE |
| Commercial transaction — EEA & UK | 4.69% + fixed fee | Buyer is in the EEA or UK |
| Commercial transaction — all other markets, by monthly volume | see below | Buyer is anywhere else (US, Canada, most of the world) |
| Currency conversion spread | **4.0%** above the base exchange rate | Buyer pays in a currency other than the account's (Middle East & Africa region rate) |
| Conversion spread — balance transfer / withdrawal | 3.0% above the base exchange rate | Moving funds out of PayPal, e.g. to a bank |

The "all other markets" rate is itself tiered by trailing monthly sales
volume — confirmed against the calculator Ms. K currently uses (see below).
The lowest tier (Ms. K's actual tier) has since been corrected against real
transaction data; the other three remain unvalidated designhill-sourced
figures and should be treated as suspect until observed:

| Monthly volume | Published rate | Observed rate | Fixed fee |
|---|---|---|---|
| $0 – $3,000 *(Ms. K's tier)* | ~~4.40%~~ | **4.625%** (band 4.60–4.65%) | **$0.31** *(observed; PayPal's published $0.30 is individually in-band but not jointly feasible with 4.625% — see below)* |
| $3,000.01 – $10,000 | 3.90% | unvalidated | $0.30 |
| $10,000.01 – $100,000 | 3.70% | unvalidated | $0.30 |
| above $100,000 | 3.40% | unvalidated | $0.30 |

See "Observed transactions (ground truth)" below for how 4.625% and the
observed $0.31 were derived, and why the published 4.40% figure is retained
in this table rather than deleted.

Confirmed with the user: Ms. K does **not** qualify for PayPal's
merchant-tier (volume-discounted) rates (see "Open questions" below). The
three higher tiers above are consequently not accessible to her regardless
of trailing volume; the table is retained for completeness, but her
practical rate is always the $0–$3,000 row.

### Buyer-market classification (v0.4)

The three market buckets above (UAE / EEA & UK / all other markets) are
PayPal's, not ours — but asking Ms. K to classify a client into one of
them directly invites mistakes, since the bucket boundaries don't match
intuition. The calculator (`src/app/page.tsx`,
`src/components/calculator-form.tsx`) instead asks for the client's
**country** and maps it to the correct bucket in code
(`src/lib/fees/markets.ts`), with the resolved bucket shown alongside
the picker so the mapping stays auditable. The case this exists to
prevent: **Switzerland is EFTA, not EEA**, so a Swiss client is `OTHER`
(4.625%), not `EEA_UK` (4.69%) — an easy mistake to make by hand that a
country-name picker resolves by construction.

### Fixed fee by currency (published)

Sourced from PayPal's business fees page
(`paypal.com/ae/business/paypal-business-fees`, last updated 2026-05-28),
confirmed with the user as the source of truth for fixed fees in
currencies other than USD. As of v0.4, this table is implemented
directly in `src/lib/fees/currencies.ts` — the fixed-fee component of
the commercial fee is looked up by currency, not derived from the USD
figure via the FX rate as it was in v0.1–v0.3 (see "Open questions"
below, question 1, now resolved):

| Currency | Fixed fee |
|---|---|
| US dollar (USD) | 0.30 *(published — observed value is $0.31, see "Observed transactions")* |
| Canadian dollar (CAD) | 0.30 |
| Euro (EUR) | 0.35 |
| UK pounds sterling (GBP) | 0.20 |
| Swiss franc (CHF) | 0.55 |
| Australian dollar (AUD) | 0.30 |
| New Zealand dollar (NZD) | 0.45 |
| Singapore dollar (SGD) | 0.50 |
| Hong Kong dollar (HKD) | 2.35 |
| Japanese yen (JPY) | 40.00 |
| Swedish krona (SEK) | 3.25 |
| Norwegian krone (NOK) | 2.80 |
| Danish krone (DKK) | 2.60 |
| Polish zloty (PLN) | 1.35 |
| Czech koruna (CZK) | 10.00 |
| Hungarian forint (HUF) | 90.00 |
| Israeli new shekel (ILS) | 1.20 |
| Mexican peso (MXN) | 4.00 |
| Brazilian real (BRL) | 0.60 |
| Malaysian ringgit (MYR) | 2.00 |
| Philippine peso (PHP) | 15.00 |
| New Taiwan dollar (TWD) | 10.00 *(not supported — see note below)* |
| Thai baht (THB) | 11.00 |
| Russian ruble (RUB) | 10.00 *(not supported — see note below)* |

Given the USD discrepancy above (published $0.30, observed $0.31 — a
+3.3% gap), treat every other currency's figure here as similarly liable
to be slightly off from what a real transaction would show. None of
these non-USD figures are validated against a real transaction yet.

**TWD and RUB are not settleable or quotable** despite appearing in
PayPal's table: Frankfurter/ECB, this project's only FX rate source (see
"Tech stack" below), has no rate for either currency, so there is no way
to convert a TWD or RUB payment to USD regardless of the fixed fee being
known. The other 22 currencies in this table are implemented in
`src/lib/fees/currencies.ts`.

### Reconciling with Ms. K's current tool

Ms. K currently quotes her US-based clients using
[designhill.com's PayPal fee calculator](https://www.designhill.com/tools/paypal-fee-calculator).
Its page copy is thin, so its actual JavaScript source was read directly
rather than trusted at face value:

```js
var paypalPercentage = 3.4;
var paypalAddition = 0.30;
function setPapPalCommissionToolsPg(){
    var amt = parseFloat($("#amt").val());
    paypalPercentage = 4.4;
    if (amt >= 3000.01 && amt <= 10000)   paypalPercentage = 3.9;
    if (amt >= 10000.01 && amt <= 100000) paypalPercentage = 3.7;
    if (amt > 100000) paypalPercentage = 3.4;
}
```

This confirms the volume-tier table above — the fixed fee (`$0.30`) matches
PayPal's own UAE fixed fee exactly, which is a real reconciliation point, not
a coincidence. But the tool has two bugs this project deliberately does not
inherit:

1. **Wrong tiering basis.** The tier is chosen by `amt`, the number typed
   into the tool's single input field — i.e. by the size of *this one
   transaction*, not by trailing monthly sales volume, even though the page's
   own copy describes it as a volume discount. A $15,000 invoice gets 3.7%;
   ten $1,500 invoices to the same client all get 4.4%. That isn't how
   PayPal's real volume discounts work.
2. **No currency modeling at all.** One numeric field, implicitly USD. No
   country selector, no currency selector, no FX conversion anywhere in the
   code. Its "amount to ask for" reverse calculation is also not a clean
   closed-form inverse — it's a hand-rolled expansion that approximates it
   rather than solving it exactly.

Bug 2 is the important one: if this is the tool Ms. K used to quote the
Canadian client, it silently drops the ~4% currency-conversion spread
entirely. That is very plausibly the actual mechanism behind the original
complaint — not PayPal's rules being confusing in the abstract, but a
specific tool she already trusted not showing her the FX cut.

### Observed transactions (ground truth)

Three real, completed transactions are the project's first ground truth. All
three are **USD→USD, US-based clients** — no currency conversion involved,
so they isolate the commercial transaction fee from the 4% FX spread
completely. This table is the validation set; append future observations
here rather than starting a new one.

| # | Client paid | Ms. K received | Implied fee | Effective rate |
|---|---|---|---|---|
| T1 | 83.00 USD | 78.85 USD | 4.15 USD | 5.000% |
| T2 | 101.20 USD | 96.21 USD | 4.99 USD | 4.931% |
| T3 | 120.00 USD | 114.14 USD | 5.86 USD | 4.883% |

Effective rate falls as the amount rises — the signature of a genuine fixed
fee, confirming `rate + fixed` is the right model shape.

**Out-of-sample validation:** T1 and T2 alone solve to `r = 4.615%,
f = $0.319`. That model, fitted without ever seeing T3, predicts T3's fee as
5.858 → **5.86**. Actual: **5.86**. A correct prediction on an unseen
transaction is strong evidence the linear model is genuinely right, not
curve-fitted.

**Refit across all three** (least squares): `r = 4.622%, f = $0.313`. The
cleanest exact model, reproducing all three actual fees after cent-rounding,
is **4.625% + $0.31**:

| Model | T1 | T2 | T3 | Verdict |
|---|---|---|---|---|
| 4.40% + $0.30 *(previously documented)* | 3.95 ✗ | 4.75 ✗ | 5.58 ✗ | refuted |
| 4.40% + $0.49 | 4.14 ~ | 4.94 ✗ | 5.77 ✗ | refuted |
| 4.40% + $0.50 | 4.15 ✓ | 4.95 ✗ | 5.78 ✗ | refuted |
| 5.00% flat | 4.15 ✓ | 5.06 ✗ | 6.00 ✗ | refuted |
| **4.625% + $0.31** | **4.15 ✓** | **4.99 ✓** | **5.86 ✓** | **fits all three** |

Propagating ±half-cent rounding through the three-point solve gives feasible
bands of **rate 4.60–4.65%** and **fixed $0.29–$0.34**. PayPal's published
**$0.30 fixed fee sits inside its band and is confirmed.** The previously
documented **4.40% rate falls well outside its band and is refuted** — the
first single observation (T1 alone) had suggested the fixed fee was the
problem; with three points it's clear the opposite is true. That reversal is
left in this document deliberately, as a record of why single-observation
inference was resisted and why these tables stay provisional until confirmed.

**Note on joint feasibility:** the two bands above are each marginal, not
joint — 4.625% and $0.30 individually fall inside their own bands but do not
reproduce T1/T2/T3 *together* (they predict 4.14/4.98/5.85 against actual
4.15/4.99/5.86, off by a cent each time). The exact pair used throughout this
project, including by the fee engine, is **4.625% + $0.31**, per the
"cleanest exact model" row above.

**Unexplained residual:** the observed ~4.62% sits about 0.22 percentage
points above PayPal's published "all other markets" rate of 4.40%, and is now
too *low* to be explained by the 4.69% EEA/UK rate (both clients are
US-based regardless). Something adds roughly a fifth of a percent that
PayPal's UAE fee page doesn't document. Recorded as an open anomaly, not a
conclusion — see open questions below.

**Precision limit:** these three transactions span only $37, which amplifies
rounding noise into the ±0.025pp band above. One transaction at a
substantially larger amount (~$500+) would tighten the rate band by roughly
an order of magnitude.

### Why Ms. K keeps coming up short

Because Ms. K is UAE-based and her clients are consultants scattered across the
world, the **3.40% domestic rate almost never applies to her**. The realistic
default for a new client is the *all other markets* rate (now corrected to the
observed 4.625%, see above) plus the conversion spread stacked on top:

```
4.625%  (cross-border transaction fee — observed, not PayPal's published 4.40%)
+ USD 0.31  (fixed fee — observation-consistent with PayPal's published $0.30)
+ 4.0%  (currency conversion spread, if client didn't pay in USD)
─────────────────────────────────────────────
≈ 8.6–9.1% of the payment, gone before it reaches her
```

Two deductions, applied at different stages, neither itemized by PayPal to
either party. That compounding — not any single fee — is what confused the
Canadian client and what put Ms. K in a position of eating the difference.

### Open questions

Three of the four questions originally listed here are now resolved. Per
this project's practice of keeping resolutions and reversals in the
document rather than deleting them (see "Observed transactions" above
for why), they're recorded below rather than silently dropped.

**Resolved, confirmed with the user:**

- **Does Ms. K qualify for merchant-tier (volume-discounted) rates?** No.
  She has not applied and isn't pursuing it.
- **Do the three untested volume tiers hold?** Moot as a consequence of
  the above: since Ms. K doesn't qualify for merchant-tier rates, whether
  the 3.90%/3.70%/3.40% tiers hold is no longer relevant to her account —
  her practical rate is always the $0–$3,000 tier (4.625% + $0.31,
  observed), regardless of volume. The tier table in "The current UAE fee
  schedule" above is left as-is for reference.

**Resolved in v0.4:**

1. **The fixed-fee table for currencies other than USD.** Source of truth
   confirmed with the user:
   [paypal.com/ae/business/paypal-business-fees](https://www.paypal.com/ae/business/paypal-business-fees)
   — see "Fixed fee by currency (published)" above. `src/lib/fees/currencies.ts`
   now looks the fixed fee up directly by currency, rather than deriving
   it from the USD figure via the FX rate as v0.1–v0.3 did. This resolves
   how the fee is *sourced*, not how it's *validated* — every figure
   except USD's remains `unvalidated`; only a real non-USD transaction
   can change that (see `docs/FEE-TABLE-REFRESH.md`, step 3).

**Still open:**

This materially changes the math above and remains **unresolved**. The
calculator must treat its fee table as current-best-known, not gospel,
until it's answered:

1. **Why does the observed rate (~4.62%) not match either of PayPal's
   published figures?** It's about 0.22 percentage points above the
   published "all other markets" rate (4.40%), and now too low to be the
   EEA/UK rate (4.69%) — which wouldn't apply to US-based clients anyway.
   **Parked at the user's direction** — not being actively pursued for
   now. Resolution path, if revisited: a transaction at a substantially
   larger amount (~$500+) would tighten the rate band by roughly an order
   of magnitude and confirm whether 4.625% holds at scale.

None of these block v0.1 (already shipped) — the engine ships with the
observation-corrected table above and labels every output "estimate."

(A prior open question about weekly USD→AED sweeping on withdrawal has been
removed at the user's direction — out of scope for this project.)

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | Matches the team's existing stack; deployable to Vercel with shareable links out of the box |
| Hosting | Vercel | Zero-config deploy, free tier is sufficient — no backend workload beyond a static FX fetch |
| Styling | Tailwind + shadcn/ui | Fast, consistent component base |
| FX rates | [Frankfurter](https://frankfurter.dev/) (`/v2/rates`) | Free, no API key, ECB reference rates. Supplies the **base** market rate only — PayPal's conversion spread is applied on top by our own engine, since Frankfurter doesn't know about PayPal's markup |
| Fee math | Hand-maintained, versioned table (`src/lib/fees/schedule.ts`) | PayPal publishes its fee *schedule* as a webpage, not an API — there is no endpoint to query it programmatically, so it must be curated and dated by hand. The schedule keys on `monthlyVolumeUSD` (trailing volume), `buyerMarket`, and `payCurrency` — deliberately *not* on single-transaction size, correcting the tiering bug found in the calculator Ms. K uses today (see above) |
| Testing | Vitest | Fast, TS-native; the fee engine is the credibility of the whole product and needs exhaustive unit coverage |
| Data storage | None | Shareable breakdowns encode their inputs into the URL itself. No database, no stored client data, no accounts, no auth |

### Why not integrate the PayPal API?

PayPal's REST API (`seller_receivable_breakdown` on a completed transaction)
*does* expose the actual `paypal_fee`, `net_amount`, and `exchange_rate` for a
payment that already happened. That's useful for reconciling a prediction
against reality after the fact. It is **not** useful for predicting a fee in
advance — PayPal exposes no endpoint for its fee schedule itself. So even with
API integration, the forward-looking calculator still needs the hand-curated
table this project builds. API integration is deferred to a later version as a
reconciliation feature, not a v1 requirement, and it would add OAuth
credentials and a backend that a pure calculator doesn't need.

---

## Design principles

- **Two calculation directions, and they're not symmetric.**
  `settle(grossPaid, buyerMarket, payCurrency)` answers "what will I actually
  receive." `quote(netTarget, buyerMarket, payCurrency)` answers "what do I
  invoice to net what I need" — and it is *not* simply `net / (1 - rate)`,
  because the fixed fee and the FX spread apply at different points in the
  chain and have to be unwound in the right order.
- **The fee engine is pure and isolated.** No UI dependency, no network calls
  inside the math itself. It must be testable and auditable on its own.
- **Every number is dated and sourced.** Fee tables go stale silently, which is
  the failure mode that would quietly make this tool wrong again. Every entry
  carries an `effectiveFrom` date and a source URL; the UI shows "rates as of
  \<date\>."
- **The output is a shareable artifact, not just a number.** The point of this
  project is transparency with the client, so the breakdown — a receipt-style
  ledger showing what was paid, what was deducted and why, and what arrived —
  is a first-class deliverable, not an afterthought. Visual direction and
  design tokens are recorded in `docs/plan.html`.
- **Estimates are labeled as estimates.** This tool does not claim to be
  authoritative over PayPal's own numbers, especially while the open questions
  above are unresolved. This isn't hypothetical: the rate this document
  originally cited (4.40%, taken directly from PayPal's own published UAE fee
  page) was contradicted by the first three real transactions checked against
  it — see "Observed transactions" above. The source being official doesn't
  make it correct for this account; only observation does.

---

## Roadmap

- **v0.1** — Fee engine (`settle`/`quote`) and test suite, covering the UAE fee
  table above. Named regression cases from real ground truth: T1 (83.00 →
  78.85), T2 (101.20 → 96.21), T3 (120.00 → 114.14). The README's
  Canadian-client scenario is also included, but flagged distinctly: it has
  **no ground truth** of its own, so the 4% FX spread — unlike the commercial
  rate — remains entirely unvalidated by observation.
- **v0.2** — Calculator UI: both directions, for Ms. K's own use.
- **v0.3** — Shareable client-facing breakdown (the transparency artifact).
- **v0.4** — Fee-table refresh workflow (`docs/FEE-TABLE-REFRESH.md`,
  `isScheduleReviewOverdue()`); currency coverage widened from 2 (USD,
  CAD) to the 22 currencies PayPal and Frankfurter both support, including
  JPY (the first zero-decimal currency this project handles); a country
  picker replacing direct buyer-market selection; open question 1 above
  resolved.
- **v1.0+** — Optional PayPal API reconciliation: compare predicted fees
  against actual `seller_receivable_breakdown` data from completed
  transactions.

---

## Non-goals

- Not a payment processor. It never touches Ms. K's PayPal account or moves
  money.
- Not bookkeeping or accounting software.
- Not tax or VAT handling.
- Not financial or legal advice — outputs are estimates for planning purposes.
- Not a client database. No PII is stored; shareable breakdowns are stateless,
  encoded entirely in a URL.

---

## Related documents

- [`docs/plan.html`](docs/plan.html) — the implementation plan this
  constitution was drafted from, including the visual design direction for the
  shareable breakdown.
- [`docs/plan-v0.4.html`](docs/plan-v0.4.html) — the implementation plan
  v0.4 was built from.
- `docs/FEE-TABLE-REFRESH.md` — the quarterly fee-table review checklist,
  added in v0.4.
- `README.md` — the original request that started this project.

### Sources

- [PayPal UAE merchant fees](https://www.paypal.com/ae/webapps/mpp/merchant-fees) — primary, published source, but its "all other markets" rate (4.40%) is now contradicted by three observed transactions (see "Observed transactions" above); its $0.30 fixed fee is individually plausible but not jointly consistent with the observed 4.625% rate — the observed pair is $0.31.
- [PayPal Business fees (AE)](https://www.paypal.com/ae/business/paypal-business-fees) — primary source for the fixed-fee-by-currency table (see "Fixed fee by currency (published)" above), last updated 2026-05-28. Confirmed with the user as the source of truth for non-USD fixed fees; not yet validated against any real non-USD transaction. Implemented in `src/lib/fees/currencies.ts` as of v0.4.
- [Frankfurter API currency list](https://frankfurter.dev/) — determines which of PayPal's published currencies this project can actually settle or quote in; TWD and RUB are in PayPal's table but not Frankfurter's, so both are excluded (see "Fixed fee by currency (published)" above).
- [designhill.com PayPal fee calculator](https://www.designhill.com/tools/paypal-fee-calculator) — secondary, reconciliation source. Its page source was read directly to confirm the volume-tier rate table; two defects were identified and corrected rather than reproduced (see "Reconciling with Ms. K's current tool" above). Its lowest tier's rate has since also been refuted by observed data; the other three tiers are now moot (Ms. K doesn't qualify for merchant-tier rates — see "Open questions" above). Not authoritative on its own.
- Real transaction records (T1, T2, T3) — provided directly by the user; the project's only ground-truth source so far.
- [PayPal TypeScript Server SDK — seller receivable breakdown](https://github.com/paypal/paypal-typescript-server-sdk) — via context7.
- [Frankfurter API](https://frankfurter.dev/) — via context7.
- [PayPal Business UAE limits](https://open-entity.com/blog/paypal-business-uae) — third-party, was cited as background for the merchant-tier eligibility question, since resolved (Ms. K does not qualify) — unverified.
