import Link from "next/link";
import { RatesTable } from "@/components/ledger/rates-table";
import { StatusPanel } from "@/components/ledger/status-panel";
import { signOut } from "@/lib/auth/actions";
import { requireUser } from "@/lib/auth/profile";
import { listFeeModelHistory } from "@/lib/db/fee-models";
import { formatMoney } from "@/lib/format";
import { buildRateRows } from "@/lib/fees/rate-rows";
import { excludeTransactionAction, revertToModelAction } from "./actions";
import { loadLedgerStatus } from "./status";

// src/proxy.ts already redirects signed-out requests to /login, but a
// Server Component should never rely on that alone — see the Next.js
// proxy docs' own warning that a matcher change or refactor can silently
// remove proxy coverage from a route without anyone noticing.
export default async function LedgerPage(props: PageProps<"/ledger">) {
  const user = await requireUser("/ledger");
  const searchParams = await props.searchParams;
  // Set by requireAdmin (src/lib/auth/profile.ts) when a signed-in non-admin
  // POSTs an admin-only action (exclude/revert) — a visible banner here
  // rather than a silent redirect indistinguishable from the action having
  // simply had no effect.
  const notAdmin = searchParams.error === "not_admin";
  // setOverrideAction/clearOverrideAction (./actions.ts) redirect here
  // with an arbitrary, already-human-readable message on failure — unlike
  // not_admin, there's no fixed set of override error strings to switch
  // on, so this renders whatever came back.
  const overrideError =
    !notAdmin && typeof searchParams.error === "string" ? searchParams.error : null;

  const [{ transactions, activeModel, overrides, status }, history] = await Promise.all([
    loadLedgerStatus(),
    user.role === "admin" ? listFeeModelHistory() : Promise.resolve([]),
  ]);
  const rateRows = buildRateRows(activeModel, overrides);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="flex items-center justify-between">
        <div>
          {/* Mirrors the "Ledger →" link on the calculator homepage (src/components/calculator.tsx) — this is the only way back, since /ledger has no other nav. */}
          <Link
            href="/"
            className="font-mono text-xs tracking-[0.12em] text-teal uppercase underline underline-offset-4 hover:text-teal/80"
          >
            ← msk_ppal_calc
          </Link>
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

      {notAdmin ? (
        <p className="mt-6 rounded-md border border-oxide/60 bg-oxide/10 px-3 py-2 text-sm text-oxide">
          That action needs an admin account.
        </p>
      ) : null}

      {overrideError ? (
        <p className="mt-6 rounded-md border border-oxide/60 bg-oxide/10 px-3 py-2 text-sm text-oxide">
          {overrideError}
        </p>
      ) : null}

      <p className="mt-6 text-sm">
        <Link href="/ledger/new" className="text-teal underline">
          Record a transaction
        </Link>
      </p>

      <div className="mt-8">
        <StatusPanel status={status} overrides={overrides} showDiagnostics={user.role === "admin"} />
      </div>

      <div className="mt-8">
        <p className="font-mono text-xs tracking-[0.1em] text-caption uppercase">Rates &amp; fees</p>
        <p className="mt-1 max-w-lg text-xs text-caption">
          Every figure the calculator actually uses, where it comes from, and when it took effect.
          Either account can type in a correction below as a dated override.
        </p>
        <div className="mt-3">
          <RatesTable rows={rateRows} />
        </div>
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
                    <input type="hidden" name="id" value={h.id} />
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
