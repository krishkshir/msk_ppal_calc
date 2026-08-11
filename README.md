# msk_ppal_calc

Original request:

> What is the current transaction fee algorithm or table? How do I find out what the charge is?
>
> A new client from Canada finds it confusing cos it doesn't show him the transaction fee calculation but deducted it from me.
>
> And I'm not the best at this. Thought I would ask you if you had some concept or chart.

## Current tool

<https://www.designhill.com/tools/paypal-fee-calculator>

## The transaction ledger

As of v0.5, Ms. K can record real PayPal transactions herself at
`/ledger`, and the app re-derives the fee model from them instead of
that being a manual, code-level edit.

- **`/ledger` is locked to a fixed allow-list** of email addresses — enter
  your email and, if it's on the list, a sign-in link is sent to it; no
  password. Click the link on the same device to complete sign-in. Any
  other address gets the same "check your email" screen with no email
  actually sent, so a mistyped or unrecognized address won't look like an
  error. Role (`admin`/`user`) comes from the allow-list itself, not a
  manual step — see `CLAUDE.md` § "Supabase" for how to add or remove a
  person.
- **Record a transaction** via "Record a transaction" on the ledger page
  — what the client paid, what actually landed in the USD balance, the
  buyer's country, and (if PayPal showed them to you) its own fee line
  and exchange rate, which sharply tighten what can be determined for a
  non-USD payment.
- **The status panel** on `/ledger` shows whether the recorded
  transactions still confirm the current rate, propose a new one, or
  contradict each other — and, if a new model is determined closely
  enough, an "Accept this model" button. Nothing changes silently;
  accepting is always a deliberate click.
- **Admin accounts** additionally see full feasibility diagnostics, can
  exclude or correct a transaction (kept, not deleted, so the record
  stays auditable), and can revert to any previously accepted model.

The public calculator (`/`) and the shareable breakdown (`/breakdown`)
need no sign-in and are unaffected either way. See `docs/plan-v0.5.html`
for the full design, including why the fee model can't ever be reduced
to one "true" number from a small number of transactions.

## Running locally

Requires Node.js and [pnpm](https://pnpm.io).

```
pnpm install
pnpm dev
```

The app runs at <http://localhost:3000>. The FX rate lookup (Frankfurter)
needs no API key.

The public calculator (`/`) and the shareable breakdown (`/breakdown`)
need no environment variables. The gated transaction ledger (`/ledger`,
v0.5+) needs a Supabase project — `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` at minimum; run `vercel env pull` if this
repo is already linked to the Vercel project, or see `CLAUDE.md` §
"Supabase" for how it's provisioned. Without them, `/ledger` won't load,
but `/` and `/breakdown` fall back to the same static fee schedule the
app always shipped with and work exactly as before.

Other commands:

- `pnpm build` — production build
- `pnpm test` — run the test suite once
- `pnpm test:watch` — run tests in watch mode
- `pnpm typecheck` — type-check without emitting
