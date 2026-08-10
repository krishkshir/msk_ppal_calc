import { formatMoney } from "@/lib/format";
import type { LedgerStatus } from "@/lib/fees/ledger-status";
import { acceptProposalAction } from "@/app/ledger/actions";

interface StatusPanelProps {
  status: LedgerStatus;
  /** Admin sees the full feasible-band diagnostics; Ms. K sees a plain-language read only — see docs/plan-v0.5.html "Accounts and access". */
  showDiagnostics: boolean;
}

const labelClass = "font-mono text-xs tracking-[0.1em] text-caption uppercase";

export function StatusPanel({ status, showDiagnostics }: StatusPanelProps) {
  const { commercial } = status;

  return (
    <section className="rounded-lg border border-rule p-5">
      <p className={labelClass}>Commercial rate + USD fixed fee</p>

      {commercial.kind === "contradiction" ? (
        <div className="mt-2">
          <p className="text-sm text-oxide">
            {commercial.conflicting.length === 0
              ? "No transactions recorded yet — nothing to check the model against."
              : "These transactions don't reconcile with each other under any single rate and fixed fee. The current model is kept unchanged."}
          </p>
          {commercial.conflicting.length > 0 ? (
            <p className="mt-1 text-xs text-caption">
              Possibly involved: {commercial.conflicting.map((c) => c.id).join(", ")}
            </p>
          ) : null}
        </div>
      ) : commercial.kind === "confirmed" ? (
        <div className="mt-2">
          <p className="text-sm text-ink">
            Confirmed by {commercial.confirmedByCount} transaction
            {commercial.confirmedByCount === 1 ? "" : "s"} — the current rate still fits everything
            recorded. No change proposed.
          </p>
          {showDiagnostics ? (
            <p className="mt-1 font-mono text-xs text-caption">
              Feasible fixed fees: {commercial.feasible.map((f) => `$${(f.fixedFeeMinorUnits / 100).toFixed(2)}`).join(", ")} —
              still not uniquely determined, and that&apos;s expected with this little data.
            </p>
          ) : null}
        </div>
      ) : commercial.kind === "propose" ? (
        <div className="mt-2">
          <p className="text-sm text-teal">
            Your transactions now determine a different model closely enough to propose it.
          </p>
          <p className="mt-1 font-mono text-sm text-ink">
            {(commercial.proposedModel.rateLo * 100).toFixed(3)}%–
            {(commercial.proposedModel.rateHi * 100).toFixed(3)}% +{" "}
            {formatMoney(commercial.proposedModel.fixedFeeMinorUnits, "USD")}
          </p>
          <form action={acceptProposalAction} className="mt-3">
            <input
              type="hidden"
              name="rate"
              value={(commercial.proposedModel.rateLo + commercial.proposedModel.rateHi) / 2}
            />
            <input type="hidden" name="fixedFeeMinorUnits" value={commercial.proposedModel.fixedFeeMinorUnits} />
            <button
              type="submit"
              className="rounded-md bg-teal px-4 py-1.5 font-mono text-xs tracking-wider text-paper uppercase transition-colors hover:bg-teal/90"
            >
              Accept this model
            </button>
          </form>
        </div>
      ) : (
        <div className="mt-2">
          <p className="text-sm text-brass">
            One or more transactions rule out the current model, but the data doesn&apos;t yet agree
            closely enough on what replaces it. The current model is kept unchanged.
          </p>
          <p className="mt-1 text-xs text-caption">
            A transaction well above{" "}
            {formatMoney(commercial.largestObservedGrossMinorUnits, "USD")} (your largest recorded so
            far) would narrow this the fastest.
          </p>
        </div>
      )}

      {status.currencyFees.length > 0 ? (
        <div className="mt-5 border-t border-rule pt-4">
          <p className={labelClass}>Per-currency fixed fees</p>
          <ul className="mt-2 space-y-1 text-sm text-ink">
            {status.currencyFees.map(({ payCurrency, verdict }) => (
              <li key={payCurrency}>
                {payCurrency}:{" "}
                {verdict.kind === "confirmed"
                  ? "confirmed"
                  : verdict.kind === "propose"
                    ? `propose ${formatMoney(verdict.proposedFixedFeeMinorUnits, payCurrency)}`
                    : verdict.kind === "contradiction"
                      ? "contradicts itself"
                      : "no data"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 border-t border-rule pt-4">
        <p className={labelClass}>Currency conversion spread</p>
        <p className="mt-1 text-sm text-ink">
          {status.spread.kind === "no-data"
            ? "No cross-currency transactions recorded yet."
            : status.spread.kind === "confirmed"
              ? "Confirmed by the transactions recorded."
              : status.spread.kind === "contradiction"
                ? "Cross-currency transactions contradict each other."
                : status.spread.kind === "unresolved"
                  ? status.spread.reason === "not-pinned"
                    ? "Rules out the current spread, but only against an assumed fixed fee — record PayPal's own fee line on a cross-currency transaction to pin this."
                    : "Rules out the current spread, but the band is still too wide to propose a replacement."
                  : "A new spread is determined closely enough to propose."}
        </p>
      </div>
    </section>
  );
}
