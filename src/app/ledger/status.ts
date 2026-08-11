import { getActiveFeeModel } from "@/lib/db/fee-models";
import { getActiveOverridesWithSetter } from "@/lib/db/fee-overrides";
import { listTransactions, type TransactionRow } from "@/lib/db/transactions";
import { computeLedgerStatus, type LedgerStatus } from "@/lib/fees/ledger-status";
import type { ActiveFeeModelRow } from "@/lib/fees/model";
import type { ActiveOverrides } from "@/lib/fees/overrides";

/**
 * Fetches transactions + the active model + any manual overrides and
 * derives the ledger status from them — the one place both the status
 * panel (src/app/ledger/page.tsx) and acceptProposalAction
 * (src/app/ledger/actions.ts) get this, so an accept can never be steered
 * by a client-submitted rate/fixedFee that doesn't match what a fresh
 * recomputation actually determines. overrides comes from
 * getActiveOverridesWithSetter — the authenticated variant that carries
 * setByEmail, since every /ledger reader is already authenticated — so
 * the rates table (src/lib/fees/rate-rows.ts) can show who set a figure.
 */
export async function loadLedgerStatus(): Promise<{
  transactions: TransactionRow[];
  activeModel: ActiveFeeModelRow | null;
  overrides: ActiveOverrides;
  status: LedgerStatus;
}> {
  const [transactions, activeModel, overrides] = await Promise.all([
    listTransactions(),
    getActiveFeeModel(),
    getActiveOverridesWithSetter(),
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
  return { transactions, activeModel, overrides, status };
}
