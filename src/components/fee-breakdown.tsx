import type { Breakdown, DisplayConfidence } from "@/lib/fees/types";
import { formatAmount, formatMoney } from "@/lib/format";

interface FeeBreakdownProps {
  breakdown: Breakdown;
  /** "CLIENT PAYS" in settle mode, "YOU INVOICE" in quote mode. */
  topLabel: string;
  /** Shown under the final row in quote mode, to confirm the rounded-up invoice meets the target. */
  footnote?: string;
  /** Label for the final row. Defaults to "YOU RECEIVE"; the shared client-facing page uses "AMOUNT RECEIVED". */
  receivedLabel?: string;
}

const CONFIDENCE_LABEL: Record<DisplayConfidence, string> = {
  observed: "Observed",
  estimated: "Estimated",
  unvalidated: "Unvalidated",
  manual: "Overridden",
};

const CONFIDENCE_CLASS: Record<DisplayConfidence, string> = {
  observed: "border-teal/50 text-teal",
  estimated: "border-brass/60 text-brass",
  unvalidated: "border-oxide/50 text-oxide",
  manual: "border-ink/50 text-ink",
};

function ConfidenceBadge({ confidence, note }: { confidence: DisplayConfidence; note?: string }) {
  return (
    <span
      title={note}
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-mono text-[0.65rem] tracking-wider uppercase ${CONFIDENCE_CLASS[confidence]}`}
    >
      {CONFIDENCE_LABEL[confidence]}
    </span>
  );
}

interface Row {
  key: string;
  label: string;
  amount: string;
  /** Width of the fill, as a fraction (0-1) of this row's phase starting amount. */
  fraction: number;
  tone: "gross" | "deduction" | "result" | "transition";
  badge?: { confidence: DisplayConfidence; note?: string };
  /** Rendered as a caption directly above this row, marking a currency-phase change. */
  dividerAbove?: string;
}

function safeDivide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function buildRows(breakdown: Breakdown, topLabel: string, receivedLabel: string): Row[] {
  const { grossPaid, commercialFee, fxConversion, received } = breakdown;
  const netInPayCurrency = grossPaid.minorUnits - commercialFee.minorUnits;

  const rows: Row[] = [
    {
      key: "gross",
      label: topLabel,
      amount: formatMoney(grossPaid.minorUnits, grossPaid.currency),
      fraction: 1,
      tone: "gross",
    },
    {
      key: "fee",
      label: "− Cross-border fee",
      amount: `− ${formatAmount(commercialFee.minorUnits, commercialFee.currency)}`,
      fraction: safeDivide(netInPayCurrency, grossPaid.minorUnits),
      tone: "deduction",
      badge: { confidence: commercialFee.confidence, note: commercialFee.note },
    },
  ];

  if (!fxConversion) {
    rows.push({
      key: "result",
      label: receivedLabel,
      amount: formatMoney(received.minorUnits, received.currency),
      fraction: safeDivide(received.minorUnits, grossPaid.minorUnits),
      tone: "result",
    });
    return rows;
  }

  const atBaseRateMinorUnits = fxConversion.minorUnits + received.minorUnits;
  rows.push(
    {
      key: "converted",
      label: "Converted to USD, before the spread",
      amount: formatMoney(atBaseRateMinorUnits, received.currency),
      fraction: 1,
      tone: "transition",
      dividerAbove:
        "Two separate deductions, at different points in the chain — PayPal itemizes neither.",
    },
    {
      key: "fx",
      label: "− Currency conversion spread",
      amount: `− ${formatAmount(fxConversion.minorUnits, fxConversion.currency)}`,
      fraction: safeDivide(received.minorUnits, atBaseRateMinorUnits),
      tone: "deduction",
      badge: { confidence: fxConversion.confidence, note: fxConversion.note },
    },
    {
      key: "result",
      label: receivedLabel,
      amount: formatMoney(received.minorUnits, received.currency),
      fraction: safeDivide(received.minorUnits, atBaseRateMinorUnits),
      tone: "result",
    },
  );

  return rows;
}

const FILL_CLASS: Record<Row["tone"], string> = {
  gross: "bg-ink/20",
  deduction: "bg-ink",
  transition: "bg-ink/20",
  result: "bg-teal",
};

function LedgerRow({ row }: { row: Row }) {
  const isFinal = row.tone === "result";
  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={`flex items-center gap-2 ${
            isFinal ? "font-display text-lg" : "font-sans text-sm"
          } ${row.tone === "transition" ? "text-caption" : "text-ink"}`}
        >
          {row.label}
          {row.badge ? <ConfidenceBadge confidence={row.badge.confidence} note={row.badge.note} /> : null}
        </span>
        <span
          className={`font-mono tabular-nums ${
            isFinal ? "text-xl" : "text-sm"
          } ${row.tone === "deduction" ? "text-oxide" : "text-ink"}`}
        >
          {row.amount}
        </span>
      </div>
      <div className="relative mt-2 h-1.5 w-full bg-paper-dim">
        <div
          className={`h-full motion-safe:transition-[width] motion-safe:duration-500 motion-safe:ease-out ${FILL_CLASS[row.tone]}`}
          style={{ width: `${Math.min(100, Math.max(0, row.fraction * 100))}%` }}
        />
        {row.tone === "deduction" ? (
          <div
            className="absolute top-0 h-3 w-px -translate-y-0.5 bg-oxide"
            style={{ left: `${Math.min(100, Math.max(0, row.fraction * 100))}%` }}
            aria-hidden
          />
        ) : null}
      </div>
    </div>
  );
}

export function FeeBreakdown({
  breakdown,
  topLabel,
  footnote,
  receivedLabel = "YOU RECEIVE",
}: FeeBreakdownProps) {
  const rows = buildRows(breakdown, topLabel, receivedLabel);

  return (
    <div>
      <div className="divide-y divide-rule">
        {rows.map((row) => (
          <div key={row.key}>
            {row.dividerAbove ? (
              <p className="border-t border-rule pt-3 font-mono text-xs text-caption">
                ↓ {row.dividerAbove}
              </p>
            ) : null}
            <LedgerRow row={row} />
          </div>
        ))}
      </div>
      {footnote ? <p className="mt-2 font-mono text-xs text-caption">{footnote}</p> : null}
      <p className="mt-4 border-t border-rule pt-3 font-mono text-xs text-caption">
        Fee schedule as of {breakdown.ratesAsOf}
      </p>
    </div>
  );
}
