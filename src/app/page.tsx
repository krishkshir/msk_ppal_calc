import { Calculator } from "@/components/calculator";
import { getActiveFeeModel } from "@/lib/db/fee-models";
import { getActiveOverrides } from "@/lib/db/fee-overrides";

// Server Component: fetches the ledger's active model (v0.5) and any
// manual overrides (v0.6) once per request — both public, anon-readable
// reads (src/lib/db/fee-models.ts, src/lib/db/fee-overrides.ts) — and
// hands them to the client component that does the actual interactive
// calculation. Split out of what was a single "use client" page so this
// fetch can happen server-side rather than adding a second client-side
// round trip alongside the existing FX fetch.
export default async function Home() {
  const [activeModel, overrides] = await Promise.all([getActiveFeeModel(), getActiveOverrides()]);
  return <Calculator activeModel={activeModel} overrides={overrides} />;
}
