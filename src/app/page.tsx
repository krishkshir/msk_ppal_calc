import { Calculator } from "@/components/calculator";
import { getActiveFeeModel } from "@/lib/db/fee-models";

// Server Component: fetches the ledger's active model (v0.5) once per
// request — a public, anon-readable read (src/lib/db/fee-models.ts) — and
// hands it to the client component that does the actual interactive
// calculation. Split out of what was a single "use client" page so this
// fetch can happen server-side rather than adding a second client-side
// round trip alongside the existing FX fetch.
export default async function Home() {
  const activeModel = await getActiveFeeModel();
  return <Calculator activeModel={activeModel} />;
}
