import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/db/supabase-server";
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * Where a magic-link email points. `src/lib/db/supabase-server.ts`'s
 * `createClient()` uses `@supabase/ssr`'s `createServerClient`, which
 * hardcodes `flowType: "pkce"` on every client — including the one
 * `requestMagicLink` (src/app/login/actions.ts) uses to call
 * `signInWithOtp`. That registers a PKCE code-challenge against the OTP
 * request, so Supabase's hosted verify endpoint (the default email
 * template's `{{ .ConfirmationURL }}`) redirects back here with `?code=`
 * on success — not `token_hash`/`type`. `code` is checked first since
 * that's what the real flow sends; `token_hash`/`type` stays as a
 * fallback (a customized email template, or an admin-generated test
 * link via `supabase.auth.admin.generateLink()`, neither of which goes
 * through `signInWithOtp` and so never gets a PKCE code-challenge).
 *
 * Bug history: the original implementation only handled `token_hash`,
 * so every real magic-link click fell through to "expired or already
 * used" regardless of freshness — verification at the time used
 * `admin.generateLink()`, which bypasses `signInWithOtp` entirely and
 * so never exercised this path.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/ledger";

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      redirect(next);
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      redirect(next);
    }
  }

  redirect("/auth/auth-code-error");
}
