# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

v0.1 is implemented: the pure fee engine (`settle`/`quote`) under
`src/lib/fees/`, with an exhaustive Vitest suite (`src/lib/fees/engine.test.ts`)
covering the T1–T3 regression cases, a refutation guard for the
previously-wrong fee constants, the designhill tiering-bug check, and the
README's ground-truth-free Canadian scenario. See `docs/plan-v0.1.html` for
the implementation plan this was built from.

There is still no Next.js app, no UI, and no FX network call — those are
v0.2+ per the roadmap in `docs/CONSTITUTION.md`. `src/lib/fx/frankfurter.ts`
does not exist yet; `fxBaseRateToUSD` is an injected parameter on `settle`/`quote`
until it does.

Commands (via `pnpm`):

- `pnpm install` — install dependencies
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
- Two figures in `docs/CONSTITUTION.md` remain explicitly unresolved: the
  fixed-fee table for currencies other than USD (source of truth confirmed
  as [PayPal Business fees (AE)](https://www.paypal.com/ae/business/paypal-business-fees),
  extracted into `docs/CONSTITUTION.md` § "Fixed fee by currency
  (published)", but not yet validated against a real non-USD transaction —
  filling `schedule.ts` in from it is v0.4 work), and an unexplained
  ~0.22pp gap between the observed 4.625% rate and PayPal's published
  4.40% figure (parked at the user's direction, not being pursued). Don't
  silently resolve either while implementing — carry the "estimate"
  framing into the UI.

## Planned stack (decided, not yet installed)

Per `docs/CONSTITUTION.md`: Next.js (App Router) + TypeScript, deployed to
Vercel; Tailwind + shadcn/ui; Vitest for the fee engine; FX base rates from
the Frankfurter API (no key required); no database — shareable breakdowns
encode their inputs in the URL. No PayPal API integration in v1 (PayPal
exposes actual fees per completed transaction but no endpoint for the fee
*schedule* itself, so a hand-curated, dated table is required regardless).

## Visual verification and debugging

Once there's a UI to check (the Next.js app, or `docs/plan.html` in the
meantime), use the `claude-for-safari` skill to load a page in the user's
real Safari and screenshot it for visual verification — confirming a
rendered layout, checking a fee-breakdown UI matches the model, debugging
a CSS issue, etc. Prefer this over asking the user to manually check.

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

## Non-goals

Not a payment processor, not bookkeeping/accounting software, not tax or
VAT handling, not financial or legal advice. Outputs are estimates for
planning purposes.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
