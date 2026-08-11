import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signOut } from "@/lib/auth/actions";
import { requestMagicLink } from "./actions";

export default async function LoginPage(props: PageProps<"/login">) {
  const searchParams = await props.searchParams;
  const next = typeof searchParams.next === "string" ? searchParams.next : "/ledger";
  const sent = searchParams.sent === "1";
  // Only "rate_limit" is distinguished from the generic swallowed-error
  // path in actions.ts — see requestMagicLink's doc comment for why that
  // one error specifically is worth telling the user about.
  const rateLimited = searchParams.error === "rate_limit";
  // Set only by requireUser (src/lib/auth/profile.ts) when a valid,
  // signed-in session has no matching allowed_accounts-derived profile —
  // distinct from "signed out" because requesting another magic link
  // can't fix it; the account itself isn't on the ledger's allow-list.
  const noAccess = searchParams.error === "no_access";

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <p className="font-mono text-xs tracking-[0.12em] text-caption uppercase">msk_ppal_calc</p>
      <h1 className="mt-2 font-display text-2xl text-ink">Sign in to the ledger</h1>

      {rateLimited ? (
        <p className="mt-6 rounded-md border border-oxide/60 bg-oxide/10 px-3 py-2 text-sm text-oxide">
          Too many sign-in links requested recently — no email was sent this time. Wait a bit and
          try again.
        </p>
      ) : null}

      {noAccess ? (
        <div className="mt-6 rounded-md border border-oxide/60 bg-oxide/10 px-3 py-2 text-sm text-oxide">
          <p>That account isn&apos;t set up for this ledger. Sign out and try the address you use
          for it.</p>
          <form action={signOut} className="mt-2">
            <button type="submit" className="text-xs underline underline-offset-4">
              Sign out
            </button>
          </form>
        </div>
      ) : null}

      {sent ? (
        <p className="mt-6 text-sm text-ink">
          If that email has an account, a sign-in link is on its way. Open it on this device to
          continue — the link expires after a while, so request a new one if it doesn&apos;t work.
        </p>
      ) : (
        <form action={requestMagicLink} className="mt-6 space-y-4">
          <input type="hidden" name="next" value={next} />
          <div>
            <Label htmlFor="email" className="font-mono text-xs tracking-[0.08em] text-caption uppercase">
              Email
            </Label>
            <Input id="email" name="email" type="email" required autoFocus className="mt-1.5" />
          </div>
          <button
            type="submit"
            className="w-full rounded-md bg-teal px-4 py-2 font-mono text-xs tracking-wider text-paper uppercase transition-colors hover:bg-teal/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
          >
            Send me a sign-in link
          </button>
        </form>
      )}
    </main>
  );
}
