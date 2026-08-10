import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/db/supabase-server";
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * Where a magic-link email points — matches Supabase's default email
 * template path (`{{ .ConfirmationURL }}`), which uses `token_hash` +
 * `type`, not a PKCE `code` (see src/app/login/page.tsx's server action).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/ledger";

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      redirect(next);
    }
  }

  redirect("/auth/auth-code-error");
}
