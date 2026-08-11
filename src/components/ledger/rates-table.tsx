import type { RateRow } from "@/lib/fees/rate-rows";
import type { SourceKind } from "@/lib/fees/sources";
import { clearOverrideAction, setOverrideAction } from "@/app/ledger/actions";

interface RatesTableProps {
  rows: RateRow[];
}

const labelClass = "font-mono text-xs tracking-[0.1em] text-caption uppercase";

const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  published: "Published",
  "third-party": "Third-party",
  derived: "Computed",
  manual: "Manual",
};

const SOURCE_KIND_CLASS: Record<SourceKind, string> = {
  published: "border-teal/50 text-teal",
  "third-party": "border-brass/60 text-brass",
  derived: "border-teal/50 text-teal",
  manual: "border-ink/50 text-ink",
};

function SourceKindBadge({ kind }: { kind: SourceKind }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-mono text-[0.65rem] tracking-wider uppercase ${SOURCE_KIND_CLASS[kind]}`}
    >
      {SOURCE_KIND_LABEL[kind]}
    </span>
  );
}

function RowSource({ row }: { row: RateRow }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <SourceKindBadge kind={row.source.kind} />
        {row.source.url ? (
          <a href={row.source.url} target="_blank" rel="noopener noreferrer" className="underline">
            {row.source.label}
          </a>
        ) : (
          <span>{row.source.label}</span>
        )}
      </div>
      {row.setBy ? (
        <p className="text-xs text-caption">
          set by {row.setBy} on {row.setAt?.slice(0, 10)}
        </p>
      ) : null}
      {row.baseline ? (
        <p className="text-xs text-caption">
          masking: {row.baseline.display} ({row.baseline.source.label}, {row.baseline.effectiveDate})
        </p>
      ) : null}
      {row.note ? <p className="text-xs text-caption">{row.note}</p> : null}
    </div>
  );
}

function OverrideControl({ row }: { row: RateRow }) {
  const isOverridden = row.baseline != null;
  const unitSuffix = row.target.kind === "fixedFee" ? row.target.currency : "%";
  const today = new Date().toISOString().slice(0, 10);

  return (
    <details>
      <summary className="cursor-pointer text-xs text-teal underline">
        {isOverridden ? "Edit override" : "Override"}
      </summary>
      <div className="mt-2 space-y-2">
        <form action={setOverrideAction} className="space-y-1.5">
          <input type="hidden" name="targetKey" value={row.targetKey} />
          <label className="block text-xs text-caption">
            Value ({unitSuffix})
            <input
              type="text"
              name="value"
              defaultValue={row.formValue}
              className="mt-0.5 block w-full rounded border border-rule px-2 py-1 text-sm"
            />
          </label>
          <label className="block text-xs text-caption">
            Effective from
            <input
              type="date"
              name="effectiveFrom"
              defaultValue={isOverridden ? row.effectiveDate : today}
              max={today}
              className="mt-0.5 block w-full rounded border border-rule px-2 py-1 text-sm"
            />
          </label>
          <label className="block text-xs text-caption">
            Note (optional)
            <input
              type="text"
              name="note"
              defaultValue={isOverridden ? row.note : ""}
              className="mt-0.5 block w-full rounded border border-rule px-2 py-1 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-teal px-3 py-1 font-mono text-xs tracking-wider text-paper uppercase hover:bg-teal/90"
          >
            Save
          </button>
        </form>
        {isOverridden ? (
          <form action={clearOverrideAction}>
            <input type="hidden" name="targetKey" value={row.targetKey} />
            <button type="submit" className="text-xs text-oxide underline">
              Clear override
            </button>
          </form>
        ) : null}
      </div>
    </details>
  );
}

function RatesSection({ title, rows }: { title: string; rows: RateRow[] }) {
  return (
    <div className="mt-6 first:mt-0">
      <p className={labelClass}>{title}</p>
      <table className="mt-3 w-full text-left text-sm">
        <thead>
          <tr className="border-b border-rule text-caption">
            <th className="py-1.5 font-normal">Parameter</th>
            <th className="py-1.5 font-normal">Value</th>
            <th className="py-1.5 font-normal">Where it comes from</th>
            <th className="py-1.5 font-normal">As of</th>
            <th className="py-1.5 font-normal">&nbsp;</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.targetKey} className={`border-b border-rule align-top ${row.applicable ? "" : "opacity-50"}`}>
              <td className="py-2">
                {row.label}
                {row.applicable ? null : (
                  <p className="text-xs text-caption">not applicable — no volume-tier eligibility</p>
                )}
              </td>
              <td className="py-2 font-mono">{row.display}</td>
              <td className="py-2">
                <RowSource row={row} />
              </td>
              <td className="py-2 font-mono text-xs">{row.effectiveDate}</td>
              <td className="py-2">
                {row.applicable ? <OverrideControl row={row} /> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The full rates-and-fees table (docs/plan-v0.6.html "The table") — every
 * commercial-rate tier, per-currency fixed fee, and the FX spread the
 * engine can use, with its source and effective date, plus a per-row
 * override form. Server component (no "use client") — the whole /ledger
 * tree stays server-rendered; each row's edit affordance is a native
 * <details> wrapping a plain server-action <form>, needing zero client
 * JS even for ~30 editable rows.
 */
export function RatesTable({ rows }: RatesTableProps) {
  const commercialRows = rows.filter((r) => r.target.kind === "rate");
  const fixedFeeRows = rows.filter((r) => r.target.kind === "fixedFee");
  const fxSpreadRows = rows.filter((r) => r.target.kind === "fxSpread");

  return (
    <section className="rounded-lg border border-rule p-5">
      <RatesSection title="Commercial rate" rows={commercialRows} />
      <RatesSection title="Fixed fee per currency" rows={fixedFeeRows} />
      <RatesSection title="Currency conversion spread" rows={fxSpreadRows} />
    </section>
  );
}
