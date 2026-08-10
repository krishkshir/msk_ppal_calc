# msk_ppal_calc

Original request:

> What is the current transaction fee algorithm or table? How do I find out what the charge is?
>
> A new client from Canada finds it confusing cos it doesn't show him the transaction fee calculation but deducted it from me.
>
> And I'm not the best at this. Thought I would ask you if you had some concept or chart.

## Current tool

<https://www.designhill.com/tools/paypal-fee-calculator>

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
