# Changelog

All notable changes to this project are logged here, in reverse
chronological order. This covers documentation and domain-model changes as
well as code — for a pre-code project, doc and fee-model corrections *are*
the substantive changes.

## Unreleased

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
