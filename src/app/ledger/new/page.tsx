import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireUser } from "@/lib/auth/profile";
import { CURRENCIES } from "@/lib/fees/currencies";
import { COUNTRIES } from "@/lib/fees/markets";
import { recordTransactionAction } from "../actions";

const fieldLabelClass = "font-mono text-xs tracking-[0.08em] text-caption uppercase";

export default async function NewTransactionPage(props: PageProps<"/ledger/new">) {
  await requireUser("/ledger/new");
  const searchParams = await props.searchParams;
  const error = typeof searchParams.error === "string" ? searchParams.error : null;

  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <p className="font-mono text-xs tracking-[0.12em] text-caption uppercase">
        msk_ppal_calc · ledger
      </p>
      <h1 className="mt-2 font-display text-2xl text-ink">Record a transaction</h1>
      <p className="mt-2 text-sm text-caption">
        What a real, completed PayPal payment actually did — not an estimate. This becomes part of
        the validation set the fee model is checked against.
      </p>

      {error ? (
        <p className="mt-4 rounded-md border border-oxide/60 bg-oxide/10 px-3 py-2 text-sm text-oxide">
          {error}
        </p>
      ) : null}

      <form action={recordTransactionAction} className="mt-8 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="grossPaid" className={fieldLabelClass}>
              Client paid
            </Label>
            <Input id="grossPaid" name="grossPaid" type="text" inputMode="decimal" required className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="payCurrency" className={fieldLabelClass}>
              In currency
            </Label>
            <select
              id="payCurrency"
              name="payCurrency"
              defaultValue="USD"
              className="mt-1.5 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm text-ink"
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <Label htmlFor="receivedUSD" className={fieldLabelClass}>
            You received (USD)
          </Label>
          <Input id="receivedUSD" name="receivedUSD" type="text" inputMode="decimal" required className="mt-1.5" />
          <p className="mt-1 text-xs text-caption">
            What actually landed in your USD balance, after every deduction.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="buyerCountry" className={fieldLabelClass}>
              Buyer&apos;s country
            </Label>
            <select
              id="buyerCountry"
              name="buyerCountry"
              defaultValue="US"
              className="mt-1.5 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm text-ink"
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="paidOn" className={fieldLabelClass}>
              Date paid
            </Label>
            <Input id="paidOn" name="paidOn" type="date" className="mt-1.5" />
          </div>
        </div>

        <fieldset className="rounded-lg border border-rule px-4 py-3">
          <legend className={fieldLabelClass}>If PayPal showed you these directly (optional)</legend>
          <p className="mb-3 text-xs text-caption">
            These sharply tighten what the ledger can determine — especially for a non-USD payment.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="paypalFee" className={fieldLabelClass}>
                PayPal&apos;s fee line
              </Label>
              <Input id="paypalFee" name="paypalFee" type="text" inputMode="decimal" className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="paypalFxRate" className={fieldLabelClass}>
                PayPal&apos;s exchange rate
              </Label>
              <Input id="paypalFxRate" name="paypalFxRate" type="text" inputMode="decimal" className="mt-1.5" />
            </div>
          </div>
        </fieldset>

        <div>
          <Label htmlFor="note" className={fieldLabelClass}>
            Note (optional)
          </Label>
          <Input id="note" name="note" type="text" className="mt-1.5" />
        </div>

        <div className="flex items-center gap-4 pt-2">
          <button
            type="submit"
            className="rounded-md bg-teal px-4 py-2 font-mono text-xs tracking-wider text-paper uppercase transition-colors hover:bg-teal/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
          >
            Save transaction
          </button>
          <a href="/ledger" className="text-sm text-caption underline">
            Cancel
          </a>
        </div>
      </form>
    </main>
  );
}
