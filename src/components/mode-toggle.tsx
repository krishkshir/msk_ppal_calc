export type CalculatorMode = "quote" | "settle";

interface ModeToggleProps {
  mode: CalculatorMode;
  onChange: (mode: CalculatorMode) => void;
}

const MODES: { value: CalculatorMode; label: string }[] = [
  { value: "quote", label: "Quote — what to invoice" },
  { value: "settle", label: "Settle — what you'll receive" },
];

export function ModeToggle({ mode, onChange }: ModeToggleProps) {
  return (
    <div role="tablist" aria-label="Calculation direction" className="flex gap-7 border-b border-rule">
      {MODES.map(({ value, label }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(value)}
            className={`relative -mb-px pb-3 font-mono text-xs tracking-[0.12em] uppercase transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal ${
              active ? "text-ink" : "text-caption hover:text-ink"
            }`}
          >
            {label}
            {active ? <span className="absolute inset-x-0 -bottom-px h-0.5 bg-teal" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}
