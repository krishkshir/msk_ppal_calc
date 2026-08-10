"use client";

import { useEffect, useMemo, useState } from "react";
import { CalculatorForm } from "@/components/calculator-form";
import { FeeBreakdown } from "@/components/fee-breakdown";
import { ModeToggle, type CalculatorMode } from "@/components/mode-toggle";
import { ShareLink } from "@/components/share-link";
import { describeCalculationError } from "@/lib/fees/errors";
import { quote, settle } from "@/lib/fees/engine";
import type { Breakdown } from "@/lib/fees/types";
import type { BuyerMarket, Currency } from "@/lib/fees/types";
import { formatMoney, parseDollarsToCents } from "@/lib/format";
import { getFxRateToUSD, type FxRate } from "@/lib/fx/frankfurter";

type FxState =
  | { status: "not-needed" }
  | { status: "loading" }
  | { status: "ready"; rate: FxRate }
  | { status: "error"; message: string };

export default function Home() {
  const [mode, setMode] = useState<CalculatorMode>("quote");
  const [amountInput, setAmountInput] = useState("");
  const [buyerMarket, setBuyerMarket] = useState<BuyerMarket>("OTHER");
  const [payCurrency, setPayCurrency] = useState<Currency>("USD");
  const [fx, setFx] = useState<FxState>({ status: "not-needed" });

  useEffect(() => {
    if (payCurrency === "USD") {
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

  const amountCents = parseDollarsToCents(amountInput);

  type CalculationResult =
    | { status: "ok"; breakdown: Breakdown; topLabel: string; footnote?: string }
    | { status: "error"; message: string };

  const calculation = useMemo((): CalculationResult | null => {
    if (amountCents === null || amountCents === 0) return null;
    if (payCurrency !== "USD" && fx.status !== "ready") return null;

    const fxBaseRateToUSD = fx.status === "ready" ? fx.rate.rate : undefined;

    try {
      if (mode === "settle") {
        const breakdown = settle({
          grossPaidCents: amountCents,
          payCurrency,
          buyerMarket,
          monthlyVolumeUSDCents: 0,
          fxBaseRateToUSD,
        });
        return { status: "ok", breakdown, topLabel: "CLIENT PAYS" };
      }

      const { invoiceAmount, breakdown } = quote({
        netTargetCents: amountCents,
        payCurrency,
        buyerMarket,
        monthlyVolumeUSDCents: 0,
        fxBaseRateToUSD,
      });
      return {
        status: "ok",
        breakdown,
        topLabel: "YOU INVOICE",
        footnote: `Rounded up to guarantee at least your target of ${formatMoney(amountCents, "USD")} — invoice ${formatMoney(invoiceAmount.cents, invoiceAmount.currency)}.`,
      };
    } catch (error) {
      return { status: "error", message: describeCalculationError(error) };
    }
  }, [amountCents, mode, payCurrency, buyerMarket, fx]);

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
          buyerMarket={buyerMarket}
          onBuyerMarketChange={setBuyerMarket}
          payCurrency={payCurrency}
          onPayCurrencyChange={setPayCurrency}
        />
      </div>

      <div className="mt-10">
        {amountCents === null || amountCents === 0 ? (
          <p className="font-mono text-sm text-caption">Enter an amount to see the breakdown.</p>
        ) : payCurrency !== "USD" && fx.status === "loading" ? (
          <p className="font-mono text-sm text-caption">Fetching today&apos;s {payCurrency}→USD rate…</p>
        ) : payCurrency !== "USD" && fx.status === "error" ? (
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
                grossPaidCents: calculation.breakdown.grossPaid.cents,
                payCurrency: calculation.breakdown.grossPaid.currency,
                buyerMarket,
                fx: fx.status === "ready" ? { rate: fx.rate.rate, asOf: fx.rate.asOf } : undefined,
                scheduleAsOf: calculation.breakdown.ratesAsOf,
              }}
            />
          </>
        ) : null}
      </div>
    </main>
  );
}
