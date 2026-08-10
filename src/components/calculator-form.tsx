import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CURRENCIES } from "@/lib/fees/currencies";
import { COUNTRIES, marketForCountry } from "@/lib/fees/markets";
import type { BuyerMarket, Currency } from "@/lib/fees/types";
import type { CalculatorMode } from "@/components/mode-toggle";

interface CalculatorFormProps {
  mode: CalculatorMode;
  amountInput: string;
  onAmountChange: (value: string) => void;
  country: string;
  onCountryChange: (code: string) => void;
  payCurrency: Currency;
  onPayCurrencyChange: (value: Currency) => void;
}

const MARKET_LABEL: Record<BuyerMarket, string> = {
  OTHER: "All other markets",
  UAE: "UAE",
  EEA_UK: "EEA & UK",
};

const fieldLabelClass = "font-mono text-xs tracking-[0.08em] text-caption uppercase";
const selectClass =
  "w-full appearance-none border-0 border-b border-rule bg-transparent bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 20 20%22 fill=%22%235B6472%22><path d=%22M5.25 7.5L10 12.25L14.75 7.5H5.25Z%22/></svg>')] bg-[length:0.9rem] bg-[right_0.1rem_center] bg-no-repeat py-1.5 pr-6 font-sans text-sm text-ink focus-visible:border-teal focus-visible:outline-none";

export function CalculatorForm({
  mode,
  amountInput,
  onAmountChange,
  country,
  onCountryChange,
  payCurrency,
  onPayCurrencyChange,
}: CalculatorFormProps) {
  const amountLabel = mode === "quote" ? "You want to net" : "Client paid";
  const amountSuffix = mode === "quote" ? "USD" : payCurrency;
  const buyerMarket = marketForCountry(country);

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-[2fr_1fr_1fr]">
      <div>
        <Label htmlFor="amount" className={fieldLabelClass}>
          {amountLabel}
        </Label>
        <div className="mt-1.5 flex items-baseline gap-2 border-b border-rule focus-within:border-teal">
          <Input
            id="amount"
            inputMode="decimal"
            placeholder="0.00"
            value={amountInput}
            onChange={(event) => onAmountChange(event.target.value)}
            className="h-auto rounded-none border-0 bg-transparent p-0 py-1.5 font-mono text-2xl text-ink shadow-none focus-visible:ring-0"
          />
          <span className="pb-1.5 font-mono text-sm text-caption">{amountSuffix}</span>
        </div>
      </div>

      <div>
        <Label htmlFor="country" className={fieldLabelClass}>
          Client&apos;s location
        </Label>
        <select
          id="country"
          value={country}
          onChange={(event) => onCountryChange(event.target.value)}
          className={`mt-1.5 ${selectClass}`}
        >
          {COUNTRIES.map(({ code, name }) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
        <p className="mt-1 font-mono text-xs text-caption">
          PayPal market: {MARKET_LABEL[buyerMarket]}
        </p>
      </div>

      <div>
        <Label htmlFor="pay-currency" className={fieldLabelClass}>
          {mode === "quote" ? "Invoice in" : "Client paid in"}
        </Label>
        <select
          id="pay-currency"
          value={payCurrency}
          onChange={(event) => onPayCurrencyChange(event.target.value as Currency)}
          className={`mt-1.5 ${selectClass}`}
        >
          {CURRENCIES.map(({ code, label }) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
