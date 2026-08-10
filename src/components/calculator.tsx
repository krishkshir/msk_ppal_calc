"use client";

import { useEffect, useMemo, useState } from "react";
import { CalculatorForm } from "@/components/calculator-form";
import { FeeBreakdown } from "@/components/fee-breakdown";
import { ModeToggle, type CalculatorMode } from "@/components/mode-toggle";
import { ShareLink } from "@/components/share-link";
import { describeCalculationError } from "@/lib/fees/errors";
import { quote, settle } from "@/lib/fees/engine";
import { countrySpec, marketForCountry } from "@/lib/fees/markets";
import { resolveFeeModel, type ActiveFeeModelRow } from "@/lib/fees/model";
import {
  ACCOUNT_CURRENCY,
  REVIEW_INTERVAL_DAYS,
  SCHEDULE_LAST_REVIEWED_ON,
  isScheduleReviewOverdue,
} from "@/lib/fees/schedule";
import type { Breakdown, Currency } from "@/lib/fees/types";
import { formatMoney, parseAmountToMinorUnits } from "@/lib/format";
import { getFxRateToUSD, type FxRate } from "@/lib/fx/frankfurter";

type FxState =
  | { status: "not-needed" }
  | { status: "loading" }
  | { status: "ready"; rate: FxRate }
  | { status: "error"; message: string };

interface CalculatorProps {
  /**
   * The ledger's active fee_models row, fetched once server-side by
   * src/app/page.tsx (a public, anon-readable read — see
   * src/lib/db/fee-models.ts) — or null with no accepted ledger model
   * yet, or if the database was unreachable at request time. Either way
   * resolveFeeModel below degrades to the static schedule.ts/
   * currencies.ts constants exactly as v0.1-v0.4 always did.
   */
  activeModel: ActiveFeeModelRow | null;
}

export function Calculator({ activeModel }: CalculatorProps) {
  const [mode, setMode] = useState<CalculatorMode>("quote");
  const [amountInput, setAmountInput] = useState("");
  const [country, setCountry] = useState("US");
  const [payCurrency, setPayCurrency] = useState<Currency>("USD");
  const [fx, setFx] = useState<FxState>({ status: "not-needed" });

  const buyerMarket = marketForCountry(country);

  // Computed client-side after mount, not inline during render: this page
  // is statically generated, so a bare `isScheduleReviewOverdue(new Date())`
  // in the render body would bake in whatever was true at build time and
  // never update until the next deploy — plus it would risk a hydration
  // mismatch if the review-interval boundary falls between server render
  // and client hydration. Defaulting to false until the effect runs means
  // the banner only ever appears based on the visitor's actual clock.
  const [scheduleReviewOverdue, setScheduleReviewOverdue] = useState(false);
  useEffect(() => {
    setScheduleReviewOverdue(isScheduleReviewOverdue(new Date()));
  }, []);

  useEffect(() => {
    if (payCurrency === ACCOUNT_CURRENCY) {
      setFx({ status: "not-needed" });
      return;
    }
    let cancelled = false;
    setFx({ status: "loading" });
    getFxRateToUSD(payCurrency)
      .then((rate) => {
        if (!cancelled) setFx({ status: "ready", rate });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFx({
            status: "error",
            message: error instanceof Error ? error.message : "Could not fetch today's rate.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [payCurrency]);

  const amountCurrency = mode === "quote" ? ACCOUNT_CURRENCY : payCurrency;
  const amountMinorUnits = parseAmountToMinorUnits(amountInput, amountCurrency);

  type CalculationResult =
    | { status: "ok"; breakdown: Breakdown; topLabel: string; footnote?: string }
    | { status: "error"; message: string };

  const calculation = useMemo((): CalculationResult | null => {
    if (amountMinorUnits === null || amountMinorUnits === 0) return null;
    if (payCurrency !== ACCOUNT_CURRENCY && fx.status !== "ready") return null;

    const fxBaseRateToUSD = fx.status === "ready" ? fx.rate.rate : undefined;
    const model = resolveFeeModel(activeModel, buyerMarket, payCurrency);

    try {
      if (mode === "settle") {
        const breakdown = settle({
          grossPaidMinorUnits: amountMinorUnits,
          payCurrency,
          buyerMarket,
          monthlyVolumeUSDCents: 0,
          fxBaseRateToUSD,
          model,
        });
        return { status: "ok", breakdown, topLabel: "CLIENT PAYS" };
      }

      const { invoiceAmount, breakdown } = quote({
        netTargetCents: amountMinorUnits,
        payCurrency,
        buyerMarket,
        monthlyVolumeUSDCents: 0,
        fxBaseRateToUSD,
        model,
      });
      return {
        status: "ok",
        breakdown,
        topLabel: "YOU INVOICE",
        footnote: `Rounded up to guarantee at least your target of ${formatMoney(amountMinorUnits, ACCOUNT_CURRENCY)} — invoice ${formatMoney(invoiceAmount.minorUnits, invoiceAmount.currency)}.`,
      };
    } catch (error) {
      return { status: "error", message: describeCalculationError(error) };
    }
  }, [amountMinorUnits, mode, payCurrency, buyerMarket, fx, activeModel]);

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <header className="mb-10 border-b-2 border-ink pb-6">
        <p className="font-mono text-xs tracking-[0.12em] text-caption uppercase">
          PayPal fee calculator
        </p>
        <h1 className="mt-2 font-display text-3xl text-ink">
          What actually arrives, after PayPal&apos;s cut
        </h1>
        <p className="mt-2 max-w-md text-sm text-caption">
          PayPal deducts a transaction fee and, for cross-currency payments, a separate
          currency-conversion spread — neither itemized to you or your client.
        </p>
      </header>

      {scheduleReviewOverdue ? (
        <p className="mb-8 rounded-md border border-brass/60 bg-brass/10 px-4 py-2 font-mono text-xs text-brass">
          Fee schedule review is overdue — last checked against PayPal&apos;s published rates on{" "}
          {SCHEDULE_LAST_REVIEWED_ON}, more than {REVIEW_INTERVAL_DAYS} days ago. Figures below may
          be out of date; see docs/FEE-TABLE-REFRESH.md.
        </p>
      ) : null}

      <ModeToggle
        mode={mode}
        onChange={(nextMode) => {
          // The amount field means a different thing in each mode (target net,
          // always USD, in quote mode; gross paid, in payCurrency, in settle
          // mode) — clear it on switch rather than silently reinterpreting
          // whatever number is already typed under the other meaning.
          setMode(nextMode);
          setAmountInput("");
        }}
      />

      <div className="mt-8">
        <CalculatorForm
          mode={mode}
          amountInput={amountInput}
          onAmountChange={setAmountInput}
          country={country}
          onCountryChange={(code) => {
            setCountry(code);
            setPayCurrency(countrySpec(code).defaultCurrency);
          }}
          payCurrency={payCurrency}
          onPayCurrencyChange={setPayCurrency}
        />
      </div>

      <div className="mt-10">
        {amountMinorUnits === null || amountMinorUnits === 0 ? (
          <p className="font-mono text-sm text-caption">Enter an amount to see the breakdown.</p>
        ) : payCurrency !== ACCOUNT_CURRENCY && fx.status === "loading" ? (
          <p className="font-mono text-sm text-caption">Fetching today&apos;s {payCurrency}→USD rate…</p>
        ) : payCurrency !== ACCOUNT_CURRENCY && fx.status === "error" ? (
          <p className="font-mono text-sm text-oxide">
            Couldn&apos;t fetch today&apos;s {payCurrency}→USD rate: {fx.message}
          </p>
        ) : calculation?.status === "error" ? (
          <p className="font-mono text-sm text-oxide">{calculation.message}</p>
        ) : calculation?.status === "ok" ? (
          <>
            <FeeBreakdown
              breakdown={calculation.breakdown}
              topLabel={calculation.topLabel}
              footnote={calculation.footnote}
            />
            {fx.status === "ready" ? (
              <p className="mt-1 font-mono text-xs text-caption">
                FX rate as of {fx.rate.asOf} ({payCurrency}→USD {fx.rate.rate})
              </p>
            ) : null}
            <ShareLink
              shared={{
                grossPaidMinorUnits: calculation.breakdown.grossPaid.minorUnits,
                payCurrency: calculation.breakdown.grossPaid.currency,
                buyerMarket,
                fx: fx.status === "ready" ? { rate: fx.rate.rate, asOf: fx.rate.asOf } : undefined,
                scheduleAsOf: calculation.breakdown.ratesAsOf,
                frozen: {
                  feeMinorUnits: calculation.breakdown.commercialFee.minorUnits,
                  netMinorUnits: calculation.breakdown.received.minorUnits,
                  spreadMinorUnits: calculation.breakdown.fxConversion?.minorUnits,
                },
              }}
            />
          </>
        ) : null}
      </div>
    </main>
  );
}
