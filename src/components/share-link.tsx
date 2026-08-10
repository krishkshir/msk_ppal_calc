"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { encodeBreakdownParams, type SharedBreakdown } from "@/lib/share/breakdown-link";

interface ShareLinkProps {
  shared: SharedBreakdown;
}

export function ShareLink({ shared }: ShareLinkProps) {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(`${window.location.origin}/breakdown?${encodeBreakdownParams(shared)}`);
    setCopied(false);
    // Depend on the encoded fields, not `shared`'s object identity — the
    // parent passes a fresh literal every render, which would otherwise
    // reset `copied` back to false on any unrelated parent re-render.
  }, [shared.grossPaidCents, shared.payCurrency, shared.buyerMarket, shared.fx?.rate, shared.fx?.asOf, shared.scheduleAsOf]);

  if (!url) return null;

  return (
    <div className="mt-8 border-t border-rule pt-6">
      <p className="font-mono text-xs tracking-[0.12em] text-caption uppercase">
        Share with your client
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              // Clipboard access can be blocked (insecure context, denied permission).
              // The URL is still visible and selectable in the input below.
            }
          }}
          className="shrink-0 rounded-md bg-teal px-4 py-1.5 font-mono text-xs tracking-wider text-paper uppercase transition-colors hover:bg-teal/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
        >
          {copied ? "Copied" : "Copy link to share"}
        </button>
        <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1" />
      </div>
    </div>
  );
}
