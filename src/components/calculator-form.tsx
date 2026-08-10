import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BuyerMarket, Currency } from "@/lib/fees/types";
import type { CalculatorMode } from "@/components/mode-toggle";

interface CalculatorFormProps {
  mode: CalculatorMode;
  amountInput: string;
  onAmountChange: (value: string) => void;
  buyerMarket: BuyerMarket;
  onBuyerMarketChange: (value: BuyerMarket) => void;
  payCurrency: Currency;
  onPayCurrencyChange: (value: Currency) => void;
}

const BUYER_MARKETS: { value: BuyerMarket; label: string }[] = [
  { value: "OTHER", label: "All other markets" },
  { value: "UAE", label: "UAE" },
  { value: "EEA_UK", label: "EEA & UK" },
];

const CURRENCIES: { value: Currency; label: string }[] = [
  { value: "USD", label: "USD" },
  { value: "CAD", label: "CAD" },
];

const fieldLabelClass = "font-mono text-xs tracking-[0.08em] text-caption uppercase";
const selectClass =
  "w-full appearance-none border-0 border-b border-rule bg-transparent bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 20 20%22 fill=%22%235B6472%22><path d=%22M5.25 7.5L10 12.25L14.75 7.5H5.25Z%22/></svg>')] bg-[length:0.9rem] bg-[right_0.1rem_center] bg-no-repeat py-1.5 pr-6 font-sans text-sm text-ink focus-visible:border-teal focus-visible:outline-none";

export function CalculatorForm({
  mode,
  amountInput,
  onAmountChange,
  buyerMarket,
  onBuyerMarketChange,
  payCurrency,
  onPayCurrencyChange,
}: CalculatorFormProps) {
  const amountLabel = mode === "quote" ? "You want to net" : "Client paid";
  const amountSuffix = mode === "quote" ? "USD" : payCurrency;

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
        <Label htmlFor="buyer-market" className={fieldLabelClass}>
          Client&apos;s location
        </Label>
        <select
          id="buyer-market"
          value={buyerMarket}
          onChange={(event) => onBuyerMarketChange(event.target.value as BuyerMarket)}
          className={`mt-1.5 ${selectClass}`}
        >
          {BUYER_MARKETS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
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
          {CURRENCIES.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
