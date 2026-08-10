# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

v0.1 is implemented: the pure fee engine (`settle`/`quote`) under
`src/lib/fees/`, with an exhaustive Vitest suite (`src/lib/fees/engine.test.ts`)
covering the T1–T3 regression cases, a refutation guard for the
previously-wrong fee constants, the designhill tiering-bug check, and the
README's ground-truth-free Canadian scenario. See `docs/plan-v0.1.html` for
the implementation plan this was built from.

v0.2 is implemented: a Next.js (App Router) + Tailwind v4 + shadcn/ui
calculator at `src/app/page.tsx`, wired to the unmodified v0.1 engine. Both
directions (quote/settle) via a mode toggle, quote first. No
trailing-monthly-volume input — merchant-tier ineligibility is resolved, so
it's hardcoded to the $0–$3,000 tier. `src/lib/fx/frankfurter.ts` now exists:
an isolated fetch (never imported by `engine.ts`) supplying `fxBaseRateToUSD`
for CAD. See `docs/plan-v0.2.html` for the implementation plan this was
built from. Deployed — `vercel link` connected the GitHub repo
(`krishkshir/msk_ppal_calc`) to a new Vercel project
(`shri-kant/msk-ppal-calc`), live at `msk-ppal-calc.vercel.app`.

v0.3 is implemented: the shareable, URL-encoded client-facing breakdown at
`src/app/breakdown/page.tsx` (a Server Component reading `searchParams`),
plus `src/lib/share/breakdown-link.ts` (pure encode/decode of the query
params, including the project's first runtime validators for `Currency`/
`BuyerMarket`) and `src/components/share-link.tsx` (the copy-link
affordance on the calculator). The share URL freezes the gross amount, pay
currency, buyer market, and — for non-USD payments — the FX rate and its
date at link-creation time, plus the fee-schedule date, so a shared link
never silently re-fetches a different FX rate later; a schedule-date
mismatch on open renders a visible drift warning instead of silently
showing different numbers. `src/components/fee-breakdown.tsx` gained an
optional `receivedLabel` prop (default unchanged) so the shared page can
relabel the final row "AMOUNT RECEIVED" for a client audience; the fee
engine itself is untouched. See `docs/plan-v0.3.html` for the
implementation plan this was built from.

v0.4 is implemented: currency coverage widened from 2 (USD, CAD) to the
22 currencies PayPal and Frankfurter both support, including JPY — the
first zero-decimal currency this project handles. `src/lib/fees/currencies.ts`
(new) is now the source of truth for both the `Currency` union and each
currency's fixed fee, looked up directly rather than derived from the
USD figure via the FX rate as v0.1–v0.3 did; `src/lib/fees/markets.ts`
(new) is the source of truth for `BuyerMarket` plus a `COUNTRIES` table
driving a country picker in `src/components/calculator-form.tsx` (see
"Domain model" below for the Switzerland classification trap this
replaces). `Money.cents`/`FeeLineItem.cents` were renamed to
`minorUnits` throughout, since "cents" stopped being accurate once JPY
(minor-unit exponent 0) was in scope. `src/lib/fees/schedule.ts` gained
`SCHEDULE_LAST_REVIEWED_ON` / `isScheduleReviewOverdue()`, surfaced as a
staleness banner on `src/app/page.tsx` only (not the client-facing
`/breakdown` route) — see `docs/FEE-TABLE-REFRESH.md` for the review
checklist this operationalizes. See `docs/plan-v0.4.html` for the
implementation plan this was built from.

The share-link staleness check is fixed: v0.4's own code review found that
`scheduleAsOf` alone can't detect drift caused by a *calculation-methodology*
change (v0.4's CAD fixed fee moving from FX-derived to a flat lookup left
`SCHEDULE_EFFECTIVE_FROM` untouched, so a pre-v0.4 CAD share link silently
rendered a different received amount). `SharedBreakdown` (`src/lib/share/breakdown-link.ts`)
now optionally freezes the computed commercial fee, FX spread, and received
amount (`fee`/`net`/`spread` query params) alongside the inputs; the new
`src/lib/share/drift.ts` compares a fresh recomputation against them and, on
any mismatch, renders the frozen originals — what the client was actually
quoted — with a note, rather than the recomputed figures. Links created
before this fix carry no frozen figures and keep falling back to the old
`scheduleAsOf` comparison (now worded direction-agnostically). See
`docs/plan-share-link-drift.html` for the design this was built from.

Commands (via `pnpm`):

- `pnpm install` — install dependencies
- `pnpm dev` — run the Next.js dev server
- `pnpm build` — production build
- `pnpm test` — run the Vitest suite once
- `pnpm test:watch` — run Vitest in watch mode
- `pnpm typecheck` — `tsc --noEmit`

## Before pushing to remote

Update the affected docs in the same change — `CLAUDE.md`, `README.md`, and
anything under `docs/` (including `docs/CHANGELOG.md`) — so they reflect
what's actually true after the change, before pushing to remote. This file
already went stale once: `CONSTITUTION.md` moved into `docs/` and the path
references here weren't updated until the next session caught it. Log
every change in `docs/CHANGELOG.md` as part of the same push, including
doc-only and fee-model-correction changes, not just code.

## Read first

- `docs/CONSTITUTION.md` — mission, the fee domain model, tech stack
  rationale, design principles, roadmap, non-goals. This is the source of
  truth; the summary below is a partial index into it, not a replacement.
- `docs/plan.html` — the same content as `docs/CONSTITUTION.md`, styled as
  a standalone page. The two are kept in sync by design (duplicate
  content, not out of date with each other) — when correcting a fee figure
  or adding an observed transaction, update both.
- `docs/CHANGELOG.md` — chronological log of changes to the project.
- `README.md` — the original request that started this project, and the
  URL of the calculator Ms. K currently uses for quoting clients.

## Domain model — easy to get wrong from code alone

- Two separate deductions apply to a cross-border PayPal payment, and they
  compound rather than substitute for each other: PayPal's commercial
  transaction fee (a percentage + a fixed fee), and — only when the buyer
  pays in a currency other than the account's — a currency-conversion
  spread on top. Treat them as two line items, never merge them into one
  rate.
- **The commercial rate for Ms. K's account is not PayPal's published
  4.40%.** Three real, completed transactions (documented in
  `docs/CONSTITUTION.md` under "Observed transactions (ground truth)") refute
  that figure; the corrected values are **4.625% + $0.31**, derived from a
  three-point regression with an out-of-sample validation check. Any fee
  calculation in this project must use the corrected figures, not the
  originally-published PayPal number. Don't "fix" this back to 4.40% by
  reverting to the source page — the page is the refuted figure here.
- The observed-transactions table is the project's validation set. When a
  new real transaction is provided, it belongs there (append, don't
  replace), and the derived rate/fixed-fee model should be reconciled
  against it — this is how the 4.40% error was caught in the first place.
- Ms. K's current tool
  ([designhill.com/tools/paypal-fee-calculator](https://www.designhill.com/tools/paypal-fee-calculator))
  has two known bugs this project deliberately does not reproduce: it
  tiers its rate by the size of the single transaction entered rather than
  by trailing monthly sales volume, and it does not model currency
  conversion at all. See `docs/CONSTITUTION.md` § "Reconciling with Ms. K's
  current tool" for the actual JS source that was inspected to find these.
- The inverse calculation — "what do I invoice to net a target amount" —
  is not `net / (1 - rate)`. The fixed fee and the FX spread apply at
  different points in the chain and must be unwound in the correct order.
  See `docs/CONSTITUTION.md` § "Design principles".
- Merchant-tier eligibility is resolved: Ms. K does **not** qualify for
  PayPal's volume-discounted rates, so the three higher `OTHER`-market
  volume tiers in `docs/CONSTITUTION.md` are moot for her — her practical
  rate is always the $0–$3,000 tier (4.625% + $0.31, observed), regardless
  of volume. Don't build UI or logic that assumes she might reach those
  tiers without this being revisited.
- The buyer-market picker is country-based, not a direct UAE/EEA_UK/OTHER
  choice — Ms. K picks a country, `src/lib/fees/markets.ts`'s
  `marketForCountry()` resolves the PayPal bucket. This exists specifically
  because **Switzerland is EFTA, not EEA** — a Swiss client is `OTHER`
  (4.625%), not `EEA_UK` (4.69%), which is an easy classification mistake
  a direct bucket dropdown invites and a country name doesn't.
- One figure in `docs/CONSTITUTION.md` remains explicitly unresolved: an
  unexplained ~0.22pp gap between the observed 4.625% rate and PayPal's
  published 4.40% figure (parked at the user's direction, not being
  pursued). Don't silently resolve it while implementing — carry the
  "estimate" framing into the UI.
- The non-USD fixed-fee table (the other previously-open question) is
  resolved as of v0.4: `src/lib/fees/currencies.ts` looks up each
  currency's fixed fee directly from PayPal's published table
  ([PayPal Business fees (AE)](https://www.paypal.com/ae/business/paypal-business-fees)),
  rather than deriving it from the USD figure via the FX rate. Only USD's
  figure is `"observed"` (the $0.31 from T1–T3); every other currency's
  is `"unvalidated"` — resolving *where the number comes from* isn't the
  same as *validating it*, and the UI must keep saying so.
- **JPY, and any future zero-decimal currency, needs minor-unit-aware FX
  scaling — this was a latent bug until v0.4 added a second currency
  exponent to test against.** `fxBaseRateToUSD` is always USD per 1
  *major* unit of the pay currency (e.g. USD per 1 yen), but the engine
  operates entirely in *minor* units. Multiplying a minor-unit amount
  directly by that rate is only correct when the pay currency's
  minor-unit exponent matches USD's (2) — true for every currency here
  except JPY (exponent 0). `src/lib/fees/engine.ts`'s
  `fxRateInMinorUnits` scales the rate by `10 ** (usdExponent -
  payCurrencyExponent)` before applying it; skipping that scaling
  silently produces amounts off by a power of ten. This was invisible
  through v0.1–v0.3 because CAD (exponent 2, same as USD) was the only
  non-USD currency in scope.

## Stack

Per `docs/CONSTITUTION.md`, now installed: Next.js (App Router) + TypeScript,
deployed to Vercel; Tailwind v4 + shadcn/ui; Vitest for the fee engine, the
FX fetch, and the share-link encode/decode. FX base rates from the
Frankfurter API (no key required). No database — the shareable breakdown
(v0.3) encodes its inputs entirely in the URL, per plan. No PayPal API
integration in v1 (PayPal exposes actual fees per completed transaction but
no endpoint for the fee *schedule* itself, so a hand-curated, dated table is
required regardless).

## Visual verification and debugging

For the Next.js app (`pnpm dev`, or a Vercel deployment URL) or a static doc
like `docs/plan.html`, use the `claude-for-safari` skill to load the page in
the user's real Safari and screenshot it for visual verification —
confirming a rendered layout, checking a fee-breakdown UI matches the
model, debugging a CSS issue, etc. Prefer this over asking the user to
manually check.

- Open the target in a **new tab**, not the user's current tab — don't
  navigate away from tabs they already have open. Close that tab when
  done.
- Verified in this repo: the skill's documented screenshot path
  (`safari_wid` + `screencapture -l <CGWindowID>`) was unreliable here —
  it intermittently returned a bogus small window or nothing, even
  though Screen Recording permission itself works fine (plain
  `screencapture -x` full-screen succeeds immediately). If the
  `safari_wid` route fails or returns implausible bounds, fall back to:
  activate Safari, read `bounds of window 1` via AppleScript, then
  `screencapture -x -R<x>,<y>,<width>,<height>` in the same shell call
  (activation and capture must happen back-to-back or focus reverts to
  the terminal).
- Save screenshots to `.playwright-mcp/` in the project root (per the
  global Playwright convention), per the global CLAUDE.md.
- Clean up when done: close the tab you opened, delete any screenshots
  and compiled helper binaries (e.g. under `/tmp/claude-for-safari`) you
  created for the check, and confirm `git status` is clean before
  finishing. Don't touch the user's other tabs.

## Tool usage

- For any library documentation (framework/SDK/API/CLI syntax, config,
  version migration) — Next.js, Tailwind, shadcn/ui, Vitest, the
  Frankfurter API, etc. — use context7 (per the global `context7` rule)
  instead of relying on training data, which may be stale.
- For any UI/UX/front-end design work — layout, visual styling, component
  aesthetics, typography — automatically invoke the
  `/frontend-design:frontend-design` skill rather than designing ad hoc.

## GitHub account

Always use the **`krishkshir`** GitHub account (the repo owner/admin) for
any GitHub action against this repo — `git push`, `gh pr create`, `gh pr
comment`, etc. The `gh` CLI's default active account may be a different,
lower-privilege account (e.g. one with only read access), which fails
non-obviously: `gh pr create` errors with "must be a collaborator" rather
than an auth error. Before any `gh` write action, check the active account
with `gh auth status` and, if it isn't `krishkshir`, switch with `gh auth
switch --user krishkshir` first.

## Vercel account

Always use the **`krishkshir`** Vercel account (team `shri-kant`) for any
Vercel action — `vercel deploy`, `vercel link`, the Vercel MCP plugin
tools, etc. Before any Vercel action, check with `vercel whoami`. Unlike
`gh`, there's no guarantee a second session is already stored locally: the
first time this came up, only a different (wrong) account was
authenticated for both the CLI and the MCP plugin, and there was no
`vercel auth switch` equivalent — the user had to run `vercel login`
themselves (interactive OAuth/email; can't be completed non-interactively)
before anything could proceed. Ask them to do that if `whoami` doesn't say
`krishkshir`.

A brand-new Vercel project's *first* deployment lands on `production` even
via a plain `vercel deploy` with no `--prod` flag — there's no preview
alias yet to default to. That's standard Vercel behavior, not a mistake,
but it means the usual "confirm before deploying to production" caution
doesn't get a chance to trigger on a project's very first deploy — flag it
to the user after the fact if it happens, same as any other production
deploy would require confirmation for.

## Non-goals

Not a payment processor, not bookkeeping/accounting software, not tax or
VAT handling, not financial or legal advice. Outputs are estimates for
planning purposes.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
