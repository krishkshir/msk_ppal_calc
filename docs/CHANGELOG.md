# Changelog

All notable changes to this project are logged here, in reverse
chronological order. This covers documentation and domain-model changes as
well as code — for a pre-code project, doc and fee-model corrections *are*
the substantive changes.

## Unreleased

- Implemented v0.5: a gated `/ledger` where Ms. K records real PayPal
  transactions herself, and the app re-derives the commercial rate,
  per-currency fixed fees, and the FX spread from them — proposing a
  change only when the data determines one closely enough, otherwise
  reporting what's missing and keeping the current model. See
  `docs/plan-v0.5.html` for the full design.
  - **Finding that shaped the design:** checked before writing the
    solver whether T1–T3 alone uniquely determine the model, and they
    don't — six different integer fixed fees ($0.29–$0.34) each admit a
    rate band reproducing all three transactions exactly, diverging by
    up to 45¢ at $1,000. `4.625% + $0.31` is the roundest of the six, not
    the unique solution. This reshaped the acceptance rule: propose a
    replacement only when every *feasible* model predicts the same fee
    (within one minor unit) across representative amounts — not when the
    parameters converge, which they never do on this little data.
  - `src/lib/fees/solve.ts` (new, pure) — exact interval-arithmetic
    feasibility solver: `solveCommercial` (rate + USD fixed fee),
    `solveCurrencyFixedFee` (per non-USD currency, given a known rate and
    a directly-observed fee — e.g. from PayPal's own displayed fee
    line), `solveConversionSpread` (the FX spread, global across
    currencies), `predictionSpread` (the actual uniqueness signal).
    `fxRateInMinorUnits` moved here from `engine.ts` into
    `currencies.ts` so both modules share one implementation.
  - `src/lib/fees/propose.ts` (new, pure) — the confirmed / propose /
    contradiction / unresolved decision table. Seeded with only T1–T3,
    correctly reports "confirmed, not yet uniquely determined" and
    proposes nothing; this is the anchor regression test.
  - `src/lib/fees/model.ts` (new) — `FeeModel`, every field independently
    optional; `resolveFeeModel()` maps a DB row to it for one specific
    `payCurrency`/`buyerMarket` call.
  - `src/lib/fees/engine.ts` — gained one optional field on
    `CommonInput`, `model?: FeeModel`. Absent, `settle`/`quote` build the
    same values from `schedule.ts`/`currencies.ts` exactly as before —
    every pre-v0.5 test and call site is unmodified, and this is also
    the fallback path when Supabase is unreachable. Fixed a real bug
    caught by a new test while wiring this in: `confidenceFor`'s
    "non-USD fixed fee can't be observed" downgrade was written for the
    static schedule, where that's true by construction — but the ledger
    *can* observe a non-USD fixed fee directly, and the downgrade was
    silently overriding a model-supplied `"observed"` confidence for
    exactly that case. Now only applies when falling back to the static
    schedule. Commercial-fee and FX-spread confidence are also now
    tracked independently (`fee_models.fx_spread_confidence`, a new
    column) — they previously shared one field, which meant a model that
    validated a currency's fixed fee would incorrectly show its
    unrelated, still-unvalidated FX spread as "observed" too.
  - `src/lib/fx/frankfurter.ts` — `getFxRateToUSD` gained an optional
    `date` argument, verified against Frankfurter's real
    `/v2/rates?date=YYYY-MM-DD&base=...&quotes=USD` endpoint (ECB data
    back to 1948, no quota). A recorded transaction's FX rate must be the
    rate on its payment date, not today's. The existing no-argument call
    site and test are unaffected.
  - **Database:** Supabase (Postgres + Auth) provisioned via
    `vercel integration add supabase` under the `shri-kant` Vercel team —
    the only external account this project's data touches, and the only
    part of the app that isn't stateless. `supabase/migrations/` —
    `profiles` (role `admin`/`user`, auto-created via an `auth.users`
    trigger), `transactions` (append-only, `excluded_reason` instead of
    delete), `fee_models` (append-only, anon-readable so the public
    calculator and `/breakdown` can read the active model with no
    session; writes are authenticated-only). Seeded with T1–T3 and the
    committed v0.4 model — reproducing today's calculator output exactly
    was the first thing verified.
  - **Auth:** magic-link sign-in (`@supabase/ssr`, `@supabase/supabase-js`).
    `src/proxy.ts` — this Next.js version renamed `middleware.ts` to
    `proxy.ts`; refreshes the session on every request and gates
    `/ledger*` only, never the whole site, since `/breakdown` links must
    stay openable with no login. `src/app/auth/confirm/route.ts` handles
    the magic-link callback via `verifyOtp({type, token_hash})` — checked
    empirically against the real provisioned project (via the Supabase
    admin API's `generateLink`, not assumed from docs alone) rather than
    two contradicting patterns surfaced by research (a `token_hash`-based
    doc and a PKCE-`code`-based one).
  - **Accounts:** self-service by design — either account can record a
    transaction and accept a proposed model, so accepting a fix never
    waits on the maintainer. Admin-only: excluding/correcting a
    transaction, editing the seeded T1–T3 rows, reverting to a prior
    accepted model (re-inserts its figures as a fresh row — `fee_models`
    stays append-only, history is never mutated).
  - `src/app/page.tsx` split into a thin Server Component (fetches the
    active model once) and `src/components/calculator.tsx` (the existing
    client-side interactive calculator, now taking `activeModel` as a
    prop) — the fetch happens server-side rather than adding a second
    client-side round trip alongside the existing FX fetch. `/` is now
    server-rendered per request instead of static, since it reads the
    live model.
  - `src/app/breakdown/page.tsx` — reads the active model the same way.
    This gives `hasFrozenDrift()` (from the share-link drift fix below) a
    real case it was only built in anticipation of: a link created
    before an accepted model change now genuinely goes stale, and the
    existing machinery already catches it correctly.
  - End-to-end verified against the real provisioned database and a
    throwaway test account (created and fully deleted via the Supabase
    admin API afterward — 0 users, 0 profiles, exactly T1–T3 and the one
    seed model remain): sign-in redirect gate, recording a transaction,
    the contradiction verdict on an inconsistent one, excluding it and
    watching the model reconfirm, a genuine resolution triggering a
    propose verdict, accepting it, and an admin reverting to the prior
    model — all through the real UI, not mocked.
- Fixed a security regression in the share-link staleness fix below, found
  by a follow-up code review run against it before it was pushed further.
  The staleness fix's first version rendered the frozen `fee`/`net`/`spread`
  figures directly whenever they disagreed with a fresh recomputation,
  captioned as "what this link originally showed" — but those are unsigned,
  attacker-editable query params with no cryptographic link to a genuine
  past `settle()` call, so anyone holding a link's URL could set
  `fee=1&net=99999` and have the page display exactly that, vouched for as
  genuine. Strictly worse than the bug being fixed, which could only ever
  show a *real* `settle()` output for some input, never an arbitrary
  fabricated number. See `docs/plan-share-link-drift.html` § "Trust
  boundary" for the corrected design.
  - `src/lib/share/drift.ts` — `applyFrozenFigures()` and
    `breakdownFromFrozenOnly()` removed entirely; only `hasFrozenDrift()`
    remains, used purely as a signal for whether to warn, never as a
    source of displayed data.
  - `src/app/breakdown/page.tsx` — `resolve()` always returns the fresh
    `settle()` recomputation as `breakdown`; `hasFrozenDrift()` only sets a
    `drifted` flag. If `settle()` throws, the page shows the same
    `engine-error` it always has, regardless of whether frozen figures are
    present — there's no recomputation to compare them against in that
    case, so there's no way to establish they're genuine before falling
    back to them. The drift warning's copy no longer claims to show "what
    this link originally showed" (it doesn't); it now says the original
    amount "may have differed from what's shown above."
  - `src/lib/share/drift.test.ts` — tests for the removed functions
    dropped; added a test asserting `hasFrozenDrift()` correctly flags a
    forged trio (`fee=1&net=99999`) as drifted, confirming detection works
    without needing or claiming provenance.
  - Accepted residual, documented rather than hidden: a forged frozen trio
    can still suppress a genuine drift warning (by matching the current
    recomputation) or cause a spurious one — but can never make the page
    display a fabricated amount. Closing that residual would need signing
    infrastructure (a server-side secret, an API route) judged
    disproportionate to what a "not financial or legal advice" estimator
    warrants.
- Fixed the share-link staleness-check bug found by the v0.4 code review
  (deliberately left unfixed by that automated pass, since the correct
  repair was a design decision — see `docs/plan-share-link-drift.html`).
  `resolved.shared.scheduleAsOf !== SCHEDULE_EFFECTIVE_FROM` was the shared
  page's only drift signal, but v0.4 changed the CAD fixed fee from
  FX-derived to a flat lookup without touching `SCHEDULE_EFFECTIVE_FROM` at
  all — a pre-v0.4 CAD link silently rendered a different `AMOUNT RECEIVED`
  (66,809 → 66,818 minor units) with no warning.
  - `src/lib/share/breakdown-link.ts` — `SharedBreakdown` gains an optional
    `frozen: { feeMinorUnits, netMinorUnits, spreadMinorUnits? }`, encoded
    as new `fee`/`net`/`spread` query params. Validated atomically (`fee`
    and `net` travel together; `spread` is coupled to `cur` exactly as
    `fx`/`on` already are) so a partially-tampered link fails to decode
    rather than half-verifying. Absent on links created before this fix —
    fully backward compatible, the existing v0.3-era round-trip test is
    untouched.
  - `src/lib/share/drift.ts` (new) — `hasFrozenDrift()` compares a fresh
    `settle()` recomputation against the frozen trio; `applyFrozenFigures()`
    overrides a recomputed `Breakdown`'s amounts (and `ratesAsOf`) with the
    frozen ones on drift, so the client sees what they were actually
    quoted, not a number that never applied to them, and the footer's
    schedule date stops contradicting the warning above it (a v0.3-era
    bug: the footer always printed the *current* schedule date even when
    showing a stale link's recomputed figures);
    `breakdownFromFrozenOnly()` synthesizes a full `Breakdown` from the
    frozen figures alone, for the case where the current engine can no
    longer accept the link's inputs at all — a shared link never becomes
    completely unrenderable just because a future engine change rejects
    its inputs.
  - `src/app/breakdown/page.tsx` — `resolve()` now compares recomputed vs.
    frozen figures and renders accordingly; the legacy `scheduleAsOf`
    fallback (for pre-fix links, which carry no frozen figures) is kept
    but reworded to be direction-agnostic — it previously said "PayPal's
    rates have since been updated" even when `scheduleAsOf` was *newer*
    than the deployed schedule.
  - `src/app/page.tsx` — `ShareLink`'s `shared` prop now includes the
    frozen trio, sourced from the same `calculation.breakdown` already
    used to build the rest of the link.
  - `src/lib/share/drift.test.ts` (new), `src/lib/share/breakdown-link.test.ts`,
    `src/lib/fees/engine.test.ts` — new round-trip, atomicity, and
    coupling cases for the frozen group; a regression test pinning the
    actual CAD 66,809 → 66,818 divergence; a USD structural-identity test
    (`gross − fee === net`, which does **not** hold across a currency
    conversion — `commercialFee` and `received` are denominated
    differently there, the trap that makes `spread` non-derivable from
    the other three figures).
- Implemented v0.4, per `docs/plan-v0.4.html`: currency coverage widened
  from 2 (USD, CAD) to the 22 currencies PayPal and Frankfurter both
  support, a country picker for buyer-market selection, a fee-table
  refresh workflow, and `CONSTITUTION.md` open question #1 resolved.
  - `src/lib/fees/currencies.ts` (new) — 22-currency table (USD, CAD,
    EUR, GBP, CHF, AUD, NZD, SGD, HKD, JPY, SEK, NOK, DKK, PLN, CZK, HUF,
    ILS, MXN, BRL, MYR, PHP, THB); TWD and RUB are in PayPal's published
    table but excluded here since Frankfurter/ECB has no rate for
    either. Each entry carries a `fixedFeeMinorUnits`, looked up
    directly by currency — the fixed fee is no longer derived from the
    USD figure via the FX rate, which is what open question #1 asked
    for. Only USD (`$0.31`, the T1–T3 observed figure, not PayPal's
    published `$0.30`) is `"observed"`; every other currency is PayPal's
    published figure, `"unvalidated"`.
  - `src/lib/fees/markets.ts` (new) — `BuyerMarket` derived from
    `BUYER_MARKETS`; a `COUNTRIES` table (47 entries: UAE, the 31-country
    EEA+UK set, 14 representative countries for the remaining supported
    currencies, and an "Other / not listed" catch-all) with
    `marketForCountry()`. Deliberately includes Switzerland mapped to
    `OTHER`, not `EEA_UK` — it's EFTA, not EEA, exactly the
    classification mistake a country picker exists to prevent over a
    direct three-bucket dropdown.
  - `src/lib/fees/engine.ts` — the fixed fee is now
    `currencySpec(payCurrency).fixedFeeMinorUnits`, not derived via FX;
    `resolveFixedFeeCents` was removed as dead code. Fixed a latent bug
    this surfaced: `fxBaseRateToUSD` is USD per 1 *major* unit of the
    pay currency, but the engine works in minor units, so converting
    between USD cents and a foreign minor unit needs a
    `10 ** (usdExponent - payCurrencyExponent)` scale factor
    (`fxRateInMinorUnits`) — without it, a zero-decimal currency like
    JPY would settle 100x too small. Invisible through v0.1–v0.3 since
    CAD (exponent 2, same as USD) was the only non-USD currency in
    scope.
  - `Money.cents`/`FeeLineItem.cents` renamed to `minorUnits` throughout
    (`types.ts`, `engine.ts`, `format.ts`, `breakdown-link.ts`, both
    UI routes) — "cents" stopped being accurate once JPY (minor-unit
    exponent 0) was in scope. `src/lib/format.ts`'s formatters are now
    keyed by each currency's `minorUnitExponent` instead of a hardcoded
    2 and `/100`. The share URL's query-param keys and encoding are
    unchanged, so v0.3-era links still decode.
  - `src/lib/share/breakdown-link.ts` and
    `src/components/calculator-form.tsx` now source their
    currency/market lists from `currencies.ts`/`markets.ts` instead of
    hand-duplicated arrays — the hazard flagged when v0.3 shipped.
  - `src/lib/fees/schedule.ts` gained `SCHEDULE_LAST_REVIEWED_ON` and
    `isScheduleReviewOverdue()` (92-day interval); surfaced as a banner
    on `src/app/page.tsx` only, not the client-facing `/breakdown`
    route. `docs/FEE-TABLE-REFRESH.md` (new) is the checklist this
    operationalizes.
  - Regression numbers that changed deliberately: the Canadian scenario
    in `engine.test.ts` moves from `4667 / 2784 / 66_809` to
    `4655 / 2784 / 66_818` (CAD's published $0.30 fixed fee vs. the old
    FX-derived ~$0.42 estimate). New tests: a JPY minor-unit-scaling
    regression, a JPY round-trip sweep, `isScheduleReviewOverdue`
    boundary cases, and currency-metadata checks alongside the existing
    schedule-metadata ones.
- Added `docs/plan-v0.4.html`: implementation proposal for the fourth
  roadmap milestone — broader currency and buyer-market coverage plus a
  fee-table refresh workflow, per `docs/CONSTITUTION.md`. Three scope
  decisions were confirmed with the user before drafting: (1) support all
  22 currencies that appear in both PayPal's published fixed-fee table and
  Frankfurter's rate list, including JPY, which has no minor decimal unit
  and requires the codebase's hardcoded "divide by 100" formatting
  assumption to become currency-aware; (2) replace the buyer-market
  dropdown with a country picker that maps a selected country to the
  correct PayPal market bucket, rather than asking Ms. K to classify UAE /
  EEA & UK / all other markets herself; (3) the refresh workflow is a
  written checklist plus review-date metadata on the schedule plus a
  staleness note surfaced in Ms. K's own calculator view (not the
  client-facing shared breakdown). The plan also resolves
  `CONSTITUTION.md`'s open question #1 (the non-USD fixed-fee table) by
  switching the engine from FX-deriving each non-USD fixed fee to a direct
  per-currency lookup of PayPal's published figures — open question #2 (the
  ~0.22pp rate gap) stays parked at the user's direction and is untouched.
- Added a "Running locally" section to `README.md`: `pnpm install` /
  `pnpm dev`, a note that no environment variables are required (the
  Frankfurter FX lookup needs no API key), and the other `pnpm` commands
  already listed in `CLAUDE.md`'s Commands section.
- Code review of the v0.3 diff found and fixed 5 issues (`/code-review
  --fix`); typecheck/tests/build verified green before and after:
  - `src/components/share-link.tsx` — the clipboard write had no
    try/catch, so a blocked `navigator.clipboard.writeText` (insecure
    context, denied permission) threw an unhandled rejection and the
    button silently never showed "Copied"; wrapped in try/catch. The
    `useEffect` resetting `copied` depended on the whole `shared` object,
    which the calculator passes as a fresh literal every render, so the
    effect re-fired (snapping "Copied" back prematurely) on any unrelated
    parent re-render, e.g. an in-flight FX fetch resolving mid-copy;
    narrowed the dependency array to the individual encoded fields.
  - `src/lib/share/breakdown-link.ts` — `isValidDateString` used regex +
    `Date.parse`, but `Date.parse` silently rolls an out-of-range day into
    the next month (`"2026-02-30"` → 2026-03-02) instead of rejecting it,
    so a link with a nonexistent calendar date in `sched` or `on` decoded
    successfully and could render a drift warning showing the literal
    nonsense date; now re-serializes the parsed date and requires an exact
    match. Also, `gross === undefined` was the only "missing" check, but
    `Number("")` is `0`, a valid non-negative integer, so an empty/
    whitespace `gross` param was silently accepted as $0 instead of
    rejected as malformed; added an explicit empty-string check.
  - `src/app/breakdown/page.tsx` — `resolve()` (decode + `settle()`) was
    called separately from both `generateMetadata` and the page component,
    redoing the same work twice per request; wrapped in React's `cache()`.
  - `src/lib/share/breakdown-link.test.ts` — 3 new regression tests for
    the above (empty gross, invalid `sched` date, invalid `on` date).
  - Not fixed, flagged only: `CURRENCIES`/`BUYER_MARKETS` in
    `breakdown-link.ts` hand-duplicate the `Currency`/`BuyerMarket` unions
    from `types.ts` with no compile-time exhaustiveness check — harmless
    today, but v0.4's broader currency coverage could add a `Currency`
    member without this file being updated to match.
- Implemented v0.3: the shareable, URL-encoded client-facing breakdown, per
  `docs/plan-v0.3.html`.
  - `src/lib/share/breakdown-link.ts` — pure `encodeBreakdownParams` /
    `decodeBreakdownParams`, the only new logic in this release. Introduces
    the project's first runtime validators for `Currency`/`BuyerMarket`
    (previously bare TS unions with no runtime guard anywhere), since a
    query string is untrusted input. 17 new Vitest cases: round-trip for
    both USD and CAD, and every rejection path (missing/malformed/tampered
    params, `fx`/`on` present or absent inconsistently with `cur`).
  - `src/app/breakdown/page.tsx` — a new async Server Component route,
    reading Next.js 16's `searchParams` promise. Reuses `settle()` and
    `<FeeBreakdown>` unmodified. Three render states: a friendly panel on a
    malformed/tampered link (never a crash), the calculator's existing
    plain-language engine-error translation on a gross below the fixed fee,
    and on success, the ledger plus a 2–3 sentence plain-language explainer
    (conditioned on whether an FX conversion applies), the estimate
    disclaimer, and a `generateMetadata` title so a pasted link previews
    meaningfully in chat/email.
  - The FX rate is frozen into the share URL at link-creation time and
    never re-fetched by the shared page — otherwise a link sent Monday
    could show different numbers by Wednesday as ECB rates move, silently
    disagreeing with the invoice actually issued. The URL also stamps the
    fee schedule's `effectiveFrom` date; the page always recomputes against
    the *current* schedule (never freezes the rate/fixed fee themselves)
    and shows a visible drift warning if that stamp no longer matches,
    rather than silently showing numbers Ms. K knows to be outdated or
    silently disagreeing with what she quoted.
  - Query params, not an opaque encoded path segment: the payload is ~60
    characters (five numbers, two enums, no PII), too small for
    compression to buy anything, and a client should be able to read in
    plain text what numbers produced the breakdown they're looking at —
    an opaque blob works against this project's transparency premise.
  - `src/components/fee-breakdown.tsx` — added an optional `receivedLabel`
    prop (default `"YOU RECEIVE"`, unchanged for the calculator) so the
    shared page can relabel the final row `"AMOUNT RECEIVED"` for a client
    audience. Nothing else in the component changed.
  - `src/lib/fees/errors.ts` — `describeCalculationError` moved out of
    `src/app/page.tsx` verbatim so both routes translate the engine's
    developer-facing exception messages into plain language the same way.
  - `src/components/share-link.tsx` — a copy-link affordance on the
    calculator, shown once a calculation succeeds. Hand-rolled against the
    existing design tokens rather than reintroducing shadcn's `Button`
    (deliberately removed in `94a3834`). Reads the invoice/settle amount,
    buyer market, and FX state already on screen — calculator mode itself
    is not encoded in the URL, since `quote()` already routes through
    `settle()` internally, so `breakdown.grossPaid.cents` is the invoice
    total regardless of which mode produced it.
  - `src/lib/fees/{types,money,schedule,engine}.ts` untouched — v0.3 adds
    no new fee math.
  - 39/39 tests green (22 existing + 17 new), typecheck clean, production
    build succeeds; `/breakdown` correctly builds as a dynamic route.
    Visually verified in Safari: USD→USD (single-phase ledger), CAD→USD
    (two-phase ledger with both confidence badges), a tampered URL, a
    gross below the fixed fee, a deliberately stale `sched` (drift
    warning), and the copy-link flow in both quote and settle mode,
    confirming the shared page reproduces the exact figures the
    calculator showed.
- Added `CLAUDE.md` § "Vercel account": always use the `krishkshir`
  account (team `shri-kant`) for Vercel actions, matching the existing
  "GitHub account" section. Found while deploying v0.2 — the `vercel`
  CLI and MCP plugin were both authenticated as a different account,
  and unlike `gh` there was no second session already stored locally,
  so the user had to run `vercel login` interactively before the
  deploy could proceed.
- Implemented v0.2: the calculator UI, per `docs/plan-v0.2.html`. Next.js
  (App Router) + TypeScript + Tailwind v4 + shadcn/ui, wired to the
  unmodified v0.1 engine (`src/lib/fees/*` untouched).
  - `src/app/page.tsx` — single page, a Quote/Settle mode toggle (Quote
    first, matching the mission's stated job ordering), inputs for
    amount, buyer market, and payment currency (USD/CAD only, matching
    the engine's current `Currency` union). No trailing-monthly-volume
    input — `monthlyVolumeUSDCents` is hardcoded to 0, directly per
    `CLAUDE.md`'s warning not to build UI around merchant-tier rates
    Ms. K doesn't qualify for.
  - `src/components/fee-breakdown.tsx` — the vertical deduction ledger
    from `docs/plan.html`'s design direction. Rendered as two linked
    phases when cross-currency (fee deduction in payCurrency, a
    currency-switch divider, then the FX spread deduction in USD),
    since the two deductions can't share one proportional bar across
    currencies. Each line item's `confidence` is a visible badge.
  - `src/lib/fx/frankfurter.ts` — isolated FX fetch (never imported by
    `engine.ts`); requesting `base=payCurrency&quotes=USD` returns the
    rate already in the units `settle`/`quote` expect, no inversion
    needed. 3 tests (mocked fetch, no live network calls in the suite).
  - Engine errors are translated to plain language for the UI (e.g. a
    transaction smaller than the fixed fee) rather than surfacing the
    developer-facing exception message raw.
  - Fixed two bugs found during visual verification in Safari: dropping
    shadcn's `@custom-variant dark` declaration left Tailwind's `dark:`
    utilities gated on `prefers-color-scheme` instead of disabled,
    silently reactivating dark-mode styling baked into shadcn's
    generated components on dark-appearance systems; and a
    `--color-muted` naming collision between a caption-text token and
    shadcn's reserved background-role token of the same name made
    captions render near-invisible (renamed to `--color-caption`).
  - 22/22 tests green (19 engine + 3 new), typecheck clean, production
    build succeeds.
  - Deployed: `vercel link` connected the GitHub repo to a new Vercel
    project (`shri-kant/msk-ppal-calc`), live at
    `msk-ppal-calc.vercel.app`. The Vercel CLI/MCP plugin were initially
    authenticated as the wrong account (mirroring the earlier `gh`
    situation) — unlike `gh`, no second session was already stored
    locally, so the user ran `vercel login` interactively. A brand-new
    project's first deployment lands on `production` even via a plain
    `vercel deploy`, since there's no preview alias yet to default to —
    noted in `CLAUDE.md` as expected Vercel behavior, not a mistake.
- Answered 2 of the 4 open questions in `docs/CONSTITUTION.md` /
  `docs/plan.html`, partially answered a 3rd, and parked the 4th, per the
  user:
  - **Merchant-tier eligibility (resolved: no).** Ms. K does not qualify
    for PayPal's volume-discounted merchant-tier rates. Added a note to
    "The current UAE fee schedule" and moved the question out of the
    open-questions list into a "Resolved" note.
  - **The three untested volume tiers (resolved: moot).** Since Ms. K
    doesn't qualify for merchant-tier rates, whether the
    3.90%/3.70%/3.40% tiers hold is no longer relevant to her account —
    her practical rate is always the $0–$3,000 tier. Also moved out of
    the open-questions list.
  - **Fixed-fee table for other currencies (source confirmed, not yet
    filled into code).** User designated
    [paypal.com/ae/business/paypal-business-fees](https://www.paypal.com/ae/business/paypal-business-fees)
    as the source of truth. Fetched and spot-checked the page (raw HTML
    matched the extracted USD/CAD figures and the "28, May 2026"
    last-updated date), then added a new "Fixed fee by currency
    (published)" table to `docs/CONSTITUTION.md` and `docs/plan.html`
    with all 24 currencies listed on that page. USD's published $0.30
    still differs from the observed $0.31 — flagged as a reason to treat
    every other currency's figure as similarly provisional. Filling
    `schedule.ts` in from this table remains v0.4 work (unchanged scope,
    per the roadmap) — this is a docs-only change, not a code change.
  - **The ~0.22pp residual gap (parked).** Left in the open-questions
    list, marked "parked at the user's direction — not being actively
    pursued for now" rather than actively unresolved.
  - Updated `docs/CONSTITUTION.md`'s Sources section (new PayPal Business
    fees citation; corrected the designhill and "PayPal Business UAE
    limits" citations to reflect the resolutions) and fixed a pre-existing
    inconsistency in `docs/plan.html`'s sources footer, where the "PayPal
    Business UAE limits" citation had drifted to describe the wrong
    (already-removed) open question.
  - Updated `CLAUDE.md`'s domain-model bullet accordingly.
  - Added a dated addendum to `docs/plan-v0.1.html`'s (historical,
    "carried forward, not resolved") open-questions section pointing to
    this resolution, and fixed a cross-reference to "open question #2"
    that broke when the open-questions list was renumbered.
- Fixed a bug from code review: `settle()` had no lower bound on
  `grossPaidCents`, so a transaction smaller than the fixed fee (e.g.
  $0.10 against the $0.31 fixed fee) silently produced a negative
  `received` amount instead of erroring. `settle()` now throws. Also:
  corrected `money.ts`'s rounding doc comment (it claimed ties round
  "away from zero"; `Math.floor(cents + 0.5)` actually rounds toward
  positive infinity — only distinguishable for negative input, which
  can no longer reach it after the guard above); had
  `engine.test.ts`'s refutation-guard test import `roundHalfUpCents`
  from `money.ts` instead of reimplementing the rounding formula
  locally; and removed `dollarsToCents`/`centsToDollars` from
  `money.ts` as unused speculative exports (no call site in this repo
  yet).
- Added `CLAUDE.md` § "GitHub account": always use the `krishkshir`
  account for GitHub write actions (`git push`, `gh pr create`, etc.).
  Found while opening the v0.1 PR — the `gh` CLI's default active account
  had only read access to this repo, which `gh pr create` reported as
  "must be a collaborator" rather than an auth error.
- Implemented v0.1: the pure fee engine (`settle`/`quote`) in
  `src/lib/fees/` (`types.ts`, `money.ts`, `schedule.ts`, `engine.ts`),
  per `docs/plan-v0.1.html`. Minimal TypeScript + Vitest scaffold
  (`package.json`, `tsconfig.json`, `vitest.config.ts`) — no Next.js/UI
  yet. 18 tests in `engine.test.ts` cover: T1/T2/T3 to the exact cent; a
  refutation guard asserting the previously-wrong 4.40%+$0.30 and
  4.625%+$0.30 pairs do *not* reproduce T1–T3; the designhill
  single-transaction-size tiering bug is not reproduced (tiers by
  trailing `monthlyVolumeUSD` only); a monotonically-decreasing
  effective-rate check; the `settle(quote(n)) >= n` round-trip property
  swept across both USD and CAD; and the README's Canadian scenario,
  named explicitly as having no ground truth, computed via the engine's
  documented "fee first, then convert" FX-order assumption. `tsc
  --noEmit` and `pnpm test` both pass. Along the way, `settle()` was
  corrected to downgrade a commercial-fee line item's confidence from
  `observed` to `estimated` whenever the payment currency isn't USD,
  since the fixed-fee portion is then an estimated currency conversion,
  not an observed figure, even though the rate itself is observed.
- Added `docs/plan-v0.1.html`: implementation proposal for the v0.1 roadmap
  milestone (fee engine + test suite) — module layout, `settle`/`quote`
  algorithms, the FX-order assumption for the ungrounded Canadian scenario,
  and the test suite including a refutation guard for the previously-wrong
  fee constants.
- Corrected the fixed fee from **$0.30** to **$0.31** in `CLAUDE.md`,
  `docs/CONSTITUTION.md`, and `docs/plan.html`. `4.625% + $0.30` — the pair
  `CLAUDE.md` previously stated — does not reproduce any of T1/T2/T3; each
  figure was individually inside its own feasible band from the three-point
  solve, but not jointly feasible with the other. `4.625% + $0.31` is the
  pair `CONSTITUTION.md`'s own derivation had already concluded fits all
  three; the surrounding docs just hadn't been made consistent with it.
  Found while planning v0.1, since the regression tests are T1/T2/T3
  themselves.
- Added `CLAUDE.md` § "Tool usage": use context7 for any library
  documentation lookups, and automatically invoke
  `/frontend-design:frontend-design` for any UI/UX/front-end design work.
- Added `CLAUDE.md` § "Visual verification and debugging": use the
  `claude-for-safari` skill to load pages in Safari and screenshot them for
  UI verification once there's a UI to check, opening a new tab and
  cleaning up (tab, screenshots, temp binaries) when done. Documents a
  verified fallback screenshot method (`screencapture -R<bounds>` from
  AppleScript-reported window bounds) since the skill's documented
  CoreGraphics-window-ID capture path proved unreliable in this
  environment.
- Added `CLAUDE.md` § "Before pushing to remote": update `CLAUDE.md`,
  `README.md`, and everything under `docs/` (including this changelog) in
  the same change before pushing.
- Added this changelog.
- Fixed stale `CONSTITUTION.md` path references in `CLAUDE.md` — the file
  had moved to `docs/CONSTITUTION.md` without the references being updated.
- Corrected the commercial transaction rate for Ms. K's PayPal tier from
  the published **4.40%** to the observation-derived **4.625%** (band
  4.60–4.65%), based on three real transactions (T1: 83.00→78.85, T2:
  101.20→96.21, T3: 120.00→114.14). The $0.30 fixed fee was confirmed,
  not changed. See `docs/CONSTITUTION.md` § "Observed transactions (ground
  truth)" for the full derivation, including the out-of-sample validation
  and the reversal of an earlier single-observation reading that had
  (incorrectly) pointed at the fixed fee instead of the rate.
- Removed the open question about weekly USD→AED balance sweeping —
  declared out of scope by the user.
- Flagged the three untested designhill-sourced volume tiers
  (3.90%/3.70%/3.40%) as suspect, since the fourth (4.40%) turned out to be
  wrong.
- Added "Reconciling with Ms. K's current tool" to `docs/CONSTITUTION.md`
  and `docs/plan.html`: documented two bugs in the designhill.com
  calculator Ms. K currently uses (tiers by single-transaction size instead
  of trailing monthly volume; no currency/FX modeling at all) found by
  reading its JavaScript source directly, and the decision not to
  reproduce either bug.
- Renamed "Karen" to "Ms. K" throughout `docs/CONSTITUTION.md` and
  `docs/plan.html`.
- Drafted `docs/CONSTITUTION.md`: mission, UAE PayPal fee schedule, tech
  stack (Next.js + TypeScript on Vercel, Frankfurter for FX, no PayPal API
  integration in v1), design principles, roadmap, non-goals.
- Drafted `docs/plan.html`: the constitution's implementation plan,
  rendered as a standalone styled page with the shareable-breakdown design
  direction (ledger-style deduction receipt).
- Created `CLAUDE.md` for the (then code-free) repository.
