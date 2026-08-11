import { getActiveFeeModel } from "@/lib/db/fee-models";
import { listTransactions, type TransactionRow } from "@/lib/db/transactions";
import { computeLedgerStatus, type LedgerStatus } from "@/lib/fees/ledger-status";
import type { ActiveFeeModelRow } from "@/lib/fees/model";

/**
 * Fetches transactions + the active model and derives the ledger status
 * from them — the one place both the status panel (src/app/ledger/page.tsx)
 * and acceptProposalAction (src/app/ledger/actions.ts) get this, so an
 * accept can never be steered by a client-submitted rate/fixedFee that
 * doesn't match what a fresh recomputation actually determines.
 */
export async function loadLedgerStatus(): Promise<{
  transactions: TransactionRow[];
  activeModel: ActiveFeeModelRow | null;
  status: LedgerStatus;
}> {
  const [transactions, activeModel] = await Promise.all([listTransactions(), getActiveFeeModel()]);
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
  return { transactions, activeModel, status };
}
