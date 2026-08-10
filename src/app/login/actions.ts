"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/db/supabase-server";

/**
 * Plain form action (no client JS required) — Ms. K is not technical, and
 * a magic-link request has nothing that benefits from client-side
 * interactivity. Always redirects, so a failed send doesn't leave her on
 * a blank screen: errors are swallowed into the same "check your email"
 * state a success would show, which also avoids confirming or denying
 * whether an email address has an account.
 */
export async function requestMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const next = String(formData.get("next") ?? "/ledger");

  if (email) {
    const supabase = await createClient();
    const origin = (await headers()).get("origin");
    await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}`,
      },
    });
  }

  redirect(`/login?sent=1&next=${encodeURIComponent(next)}`);
}
