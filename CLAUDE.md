# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

No code exists yet. The repo currently contains only planning documents:
`docs/CONSTITUTION.md`, `docs/plan.html`, `docs/CHANGELOG.md`, and
`README.md`. There is no `package.json`, no source tree, no tests, and no
commits on `main`. Before adding build/test/lint instructions here,
scaffold the project per the tech stack decided in `docs/CONSTITUTION.md`
and update this file with the real commands — don't invent them ahead of
the scaffold.

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
  that figure; the corrected values are **4.625% + $0.30**, derived from a
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
- Several figures in `docs/CONSTITUTION.md` are explicitly marked unresolved
  (merchant-tier eligibility, the three untested volume tiers, an
  unexplained ~0.22pp gap between observed and published rates). Don't
  silently resolve these while implementing — carry the "estimate" framing
  into the UI.

## Planned stack (decided, not yet installed)

Per `docs/CONSTITUTION.md`: Next.js (App Router) + TypeScript, deployed to
Vercel; Tailwind + shadcn/ui; Vitest for the fee engine; FX base rates from
the Frankfurter API (no key required); no database — shareable breakdowns
encode their inputs in the URL. No PayPal API integration in v1 (PayPal
exposes actual fees per completed transaction but no endpoint for the fee
*schedule* itself, so a hand-curated, dated table is required regardless).

## Non-goals

Not a payment processor, not bookkeeping/accounting software, not tax or
VAT handling, not financial or legal advice. Outputs are estimates for
planning purposes.
