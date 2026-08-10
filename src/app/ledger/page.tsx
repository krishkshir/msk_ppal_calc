import Link from "next/link";
import { redirect } from "next/navigation";
import { StatusPanel } from "@/components/ledger/status-panel";
import { signOut } from "@/lib/auth/actions";
import { getCurrentUser } from "@/lib/auth/profile";
import { getActiveFeeModel, listFeeModelHistory } from "@/lib/db/fee-models";
import { listTransactions } from "@/lib/db/transactions";
import { computeLedgerStatus } from "@/lib/fees/ledger-status";
import { formatMoney } from "@/lib/format";
import { excludeTransactionAction, revertToModelAction } from "./actions";

// src/proxy.ts already redirects signed-out requests to /login, but a
// Server Component should never rely on that alone — see the Next.js
// proxy docs' own warning that a matcher change or refactor can silently
// remove proxy coverage from a route without anyone noticing.
export default async function LedgerPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?next=/ledger");
  }

  const [transactions, activeModel, history] = await Promise.all([
    listTransactions(),
    getActiveFeeModel(),
    user.role === "admin" ? listFeeModelHistory() : Promise.resolve([]),
  ]);

  const status = computeLedgerStatus(
    transactions.map((t) => ({
      id: t.id,
      grossPaidMinorUnits: t.grossPaidMinorUnits,
      payCurrency: t.payCurrency,
      receivedUSDMinorUnits: t.receivedUSDMinorUnits,
      paypalFeeMinorUnits: t.paypalFeeMinorUnits,
      fxReferenceRate: t.fxReferenceRate,
      excludedReason: t.excludedReason,
    })),
    {
      rate: activeModel?.rate ?? 0.04625,
      fixedFeeMinorUnits: activeModel?.fixedFeeMinorUnits ?? 31,
      fxSpreadRate: activeModel?.fxSpreadRate ?? 0.04,
      perCurrencyFixedFees: activeModel?.perCurrencyFixedFees ?? {},
    },
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-xs tracking-[0.12em] text-caption uppercase">
            msk_ppal_calc · ledger
          </p>
          <h1 className="mt-2 font-display text-2xl text-ink">
            Signed in as {user.email ?? user.id} ({user.role})
          </h1>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="font-mono text-xs tracking-wider text-caption uppercase underline underline-offset-4 hover:text-ink"
          >
            Sign out
          </button>
        </form>
      </div>

      <p className="mt-6 text-sm">
        <Link href="/ledger/new" className="text-teal underline">
          Record a transaction
        </Link>
      </p>

      <div className="mt-8">
        <StatusPanel status={status} showDiagnostics={user.role === "admin"} />
      </div>

      <div className="mt-10">
        <p className="font-mono text-xs tracking-[0.1em] text-caption uppercase">Transactions</p>
        <table className="mt-3 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-rule text-caption">
              <th className="py-1.5 font-normal">Client paid</th>
              <th className="py-1.5 font-normal">You received</th>
              <th className="py-1.5 font-normal">Buyer country</th>
              <th className="py-1.5 font-normal">Date</th>
              {user.role === "admin" ? <th className="py-1.5 font-normal">&nbsp;</th> : null}
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.id} className={`border-b border-rule ${t.excludedReason ? "opacity-50" : ""}`}>
                <td className="py-1.5">{formatMoney(t.grossPaidMinorUnits, t.payCurrency)}</td>
                <td className="py-1.5">{formatMoney(t.receivedUSDMinorUnits, "USD")}</td>
                <td className="py-1.5">{t.buyerCountry}</td>
                <td className="py-1.5">{t.paidOn ?? "—"}</td>
                {user.role === "admin" ? (
                  <td className="py-1.5">
                    {t.excludedReason ? (
                      <span className="text-xs text-caption">excluded: {t.excludedReason}</span>
                    ) : (
                      <form action={excludeTransactionAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="reason" value="Excluded by admin" />
                        <button type="submit" className="text-xs text-oxide underline">
                          Exclude
                        </button>
                      </form>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {user.role === "admin" && history.length > 0 ? (
        <div className="mt-10">
          <p className="font-mono text-xs tracking-[0.1em] text-caption uppercase">
            Model history (admin)
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {history.map((h, i) => (
              <li key={h.id} className="flex items-center justify-between border-b border-rule pb-2">
                <span>
                  {(h.rate * 100).toFixed(3)}% + {formatMoney(h.fixedFeeMinorUnits, "USD")} — accepted{" "}
                  {h.acceptedAt.slice(0, 10)}
                </span>
                {i === 0 ? (
                  <span className="text-xs text-caption">active</span>
                ) : (
                  <form action={revertToModelAction}>
                    <input type="hidden" name="rate" value={h.rate} />
                    <input type="hidden" name="fixedFeeMinorUnits" value={h.fixedFeeMinorUnits} />
                    <input type="hidden" name="fxSpreadRate" value={h.fxSpreadRate} />
                    <button type="submit" className="text-xs text-teal underline">
                      Revert to this
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </main>
  );
}
