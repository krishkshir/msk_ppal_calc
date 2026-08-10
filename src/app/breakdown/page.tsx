import Link from "next/link";
import type { Metadata } from "next";
import { cache } from "react";
import { FeeBreakdown } from "@/components/fee-breakdown";
import { describeCalculationError } from "@/lib/fees/errors";
import { settle } from "@/lib/fees/engine";
import { SCHEDULE_EFFECTIVE_FROM } from "@/lib/fees/schedule";
import type { Breakdown } from "@/lib/fees/types";
import { formatMoney } from "@/lib/format";
import { decodeBreakdownParams, type SharedBreakdown } from "@/lib/share/breakdown-link";
import { hasFrozenDrift } from "@/lib/share/drift";

type SearchParams = { [key: string]: string | string[] | undefined };

type Resolved =
  | { status: "decode-error"; reason: string }
  | { status: "engine-error"; message: string }
  | { status: "ok"; breakdown: Breakdown; shared: SharedBreakdown; drifted: boolean };

// generateMetadata and the page component are both invoked for the same
// request; cache() dedupes the decode+settle() work between them instead
// of running it twice.
const resolve = cache((raw: SearchParams): Resolved => {
  const decoded = decodeBreakdownParams(raw);
  if (!decoded.ok) return { status: "decode-error", reason: decoded.reason };

  const shared = decoded.value;
  const { grossPaidMinorUnits, payCurrency, buyerMarket, fx, frozen } = shared;

  try {
    const breakdown = settle({
      grossPaidMinorUnits,
      payCurrency,
      buyerMarket,
      monthlyVolumeUSDCents: 0,
      fxBaseRateToUSD: fx?.rate,
    });

    // frozen (fee/net/spread) is unsigned and attacker-editable, so it's
    // used only as a signal for whether to warn — the displayed
    // breakdown is always this genuine recomputation, never frozen's
    // numbers. See docs/plan-share-link-drift.html "Trust boundary".
    const drifted = frozen != null && hasFrozenDrift(breakdown, frozen);
    return { status: "ok", breakdown, shared, drifted };
  } catch (error) {
    return { status: "engine-error", message: describeCalculationError(error) };
  }
});

export async function generateMetadata(
  props: PageProps<"/breakdown">,
): Promise<Metadata> {
  const resolved = resolve(await props.searchParams);
  if (resolved.status !== "ok") {
    return { title: "Payment breakdown — msk_ppal_calc" };
  }
  const { grossPaid, received } = resolved.breakdown;
  return {
    title: `Where your payment went — ${formatMoney(received.minorUnits, received.currency)} received of ${formatMoney(grossPaid.minorUnits, grossPaid.currency)}`,
    description:
      "A breakdown of PayPal's transaction fee and any currency-conversion spread on this payment.",
  };
}

export default async function BreakdownPage(props: PageProps<"/breakdown">) {
  const resolved = resolve(await props.searchParams);

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <header className="mb-10 border-b-2 border-ink pb-6">
        <p className="font-mono text-xs tracking-[0.12em] text-caption uppercase">
          Payment breakdown
        </p>
        <h1 className="mt-2 font-display text-3xl text-ink">Where your payment went</h1>
        <p className="mt-2 max-w-md text-sm text-caption">
          A breakdown of PayPal&apos;s deductions on this specific payment, itemized.
        </p>
      </header>

      {resolved.status === "decode-error" ? (
        <p className="font-mono text-sm text-oxide">
          This breakdown link is incomplete or damaged.{" "}
          <Link href="/" className="underline">
            Go to the calculator
          </Link>
          .
        </p>
      ) : resolved.status === "engine-error" ? (
        <p className="font-mono text-sm text-oxide">{resolved.message}</p>
      ) : (
        <>
          <FeeBreakdown
            breakdown={resolved.breakdown}
            topLabel="YOU PAY"
            receivedLabel="AMOUNT RECEIVED"
          />

          <p className="mt-6 max-w-lg text-sm text-caption">
            {resolved.breakdown.fxConversion
              ? "PayPal deducts a transaction fee, and — because you paid in a different currency than the seller's account — a separate currency-conversion spread on top. Neither is itemized on your own receipt. Both figures above are estimates."
              : "PayPal deducts a transaction fee before the payment reaches the seller. This isn't itemized on your own receipt. The figure above is an estimate."}
          </p>

          {resolved.shared.fx ? (
            <p className="mt-1 font-mono text-xs text-caption">
              FX rate as of {resolved.shared.fx.asOf} ({resolved.shared.payCurrency}→USD{" "}
              {resolved.shared.fx.rate})
            </p>
          ) : null}

          {resolved.shared.frozen ? (
            resolved.drifted ? (
              <p className="mt-4 border-t border-rule pt-3 font-mono text-xs text-brass">
                This link was created under an earlier fee schedule or calculation methodology;
                the exact amount originally shown for this payment may have differed from
                what&apos;s shown above.
              </p>
            ) : null
          ) : resolved.shared.scheduleAsOf !== SCHEDULE_EFFECTIVE_FROM ? (
            <p className="mt-4 border-t border-rule pt-3 font-mono text-xs text-brass">
              These figures were computed under the fee schedule as of{" "}
              {resolved.shared.scheduleAsOf}, which differs from our current schedule (
              {SCHEDULE_EFFECTIVE_FROM}). The numbers above reflect the current schedule.
            </p>
          ) : null}

          <p className="mt-6 font-mono text-xs text-caption">
            <Link href="/" className="underline">
              msk_ppal_calc
            </Link>{" "}
            — a calculator, not a payment processor. Not financial or legal advice.
          </p>
        </>
      )}
    </main>
  );
}
