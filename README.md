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

The app runs at <http://localhost:3000>. No environment variables are
required — the FX rate lookup (Frankfurter) needs no API key.

Other commands:

- `pnpm build` — production build
- `pnpm test` — run the test suite once
- `pnpm test:watch` — run tests in watch mode
- `pnpm typecheck` — type-check without emitting
