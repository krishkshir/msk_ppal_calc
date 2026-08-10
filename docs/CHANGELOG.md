# Changelog

All notable changes to this project are logged here, in reverse
chronological order. This covers documentation and domain-model changes as
well as code — for a pre-code project, doc and fee-model corrections *are*
the substantive changes.

## Unreleased

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
