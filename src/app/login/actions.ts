"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/db/supabase-server";

/**
 * Plain form action (no client JS required) — Ms. K is not technical, and
 * a magic-link request has nothing that benefits from client-side
 * interactivity. Always redirects, so a failed send doesn't leave her on
 * a blank screen: most errors are swallowed into the same "check your
 * email" state a success would show, which avoids confirming or denying
 * whether an email address has an account.
 *
 * One error is deliberately NOT swallowed: `over_email_send_rate_limit`
 * (Supabase's default project-level cap — 3 emails/hour on the built-in
 * email service, project-wide rather than per-address, so surfacing it
 * reveals nothing about any specific email). Without this check the form
 * always redirects to the "check your email" state even when no email
 * was sent, which reads as a broken/expired link once clicked — the
 * actual failure (no email ever sent) looks identical to the success
 * case until then.
 */
export async function requestMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const next = String(formData.get("next") ?? "/ledger");

  if (email) {
    const supabase = await createClient();
    const origin = (await headers()).get("origin");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}`,
      },
    });

    if (error?.code === "over_email_send_rate_limit") {
      redirect(`/login?error=rate_limit&next=${encodeURIComponent(next)}`);
    }
  }

  redirect(`/login?sent=1&next=${encodeURIComponent(next)}`);
}
