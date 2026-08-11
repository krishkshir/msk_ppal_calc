import { redirect } from "next/navigation";
import { createClient } from "@/lib/db/supabase-server";

export interface CurrentUser {
  id: string;
  email: string | null;
  role: "admin" | "user";
}

/**
 * Null when signed out OR when signed in but not allow-listed. Uses
 * getClaims() (JWT-verified) rather than getSession() to establish
 * identity, matching current Supabase SSR guidance — see src/proxy.ts for
 * the same reasoning.
 *
 * A valid JWT with no matching `profiles` row (possible after the
 * account-creation trigger refused it, or after an admin removes someone
 * from `public.allowed_accounts`) previously fell through to `role:
 * "user"` here — a fail-OPEN bug: `.single()`'s zero-row error was
 * discarded, and the ternary below defaulted to the least-privileged role
 * instead of no access at all. `.maybeSingle()` makes "no row" a clean
 * `data: null, error: null`, and the caller below now denies on it rather
 * than defaulting.
 */
async function resolveUser(): Promise<
  | { kind: "anonymous" }
  | { kind: "not_permitted" }
  | { kind: "ok"; user: CurrentUser }
> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) {
    return { kind: "anonymous" };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.claims.sub)
    .maybeSingle();

  if (profileError) {
    // A transient DB failure, not a real allow-list decision — fail
    // closed the same as "anonymous" (redirect to plain sign-in) rather
    // than telling a legitimate user they're not permitted.
    return { kind: "anonymous" };
  }
  if (!profile) {
    return { kind: "not_permitted" };
  }

  return {
    kind: "ok",
    user: {
      id: data.claims.sub,
      email: data.claims.email ?? null,
      role: profile.role === "admin" ? "admin" : "user",
    },
  };
}

/** Null when signed out or not allow-listed — see resolveUser's doc comment. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const resolved = await resolveUser();
  return resolved.kind === "ok" ? resolved.user : null;
}

/**
 * Redirects to /login if signed out or not allow-listed, otherwise returns
 * the signed-in user. A signed-in-but-not-permitted visitor gets
 * `?error=no_access` (a distinct message + sign-out button on the login
 * page) rather than the plain "check your email" a signed-out visitor
 * sees, since re-requesting a magic link can't help them.
 */
export async function requireUser(next: string): Promise<CurrentUser> {
  const resolved = await resolveUser();
  if (resolved.kind === "not_permitted") {
    redirect(`/login?error=no_access&next=${encodeURIComponent(next)}`);
  }
  if (resolved.kind === "anonymous") {
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  return resolved.user;
}

/** Redirects a signed-out or not-permitted visitor to /login; redirects a signed-in non-admin to /ledger. */
export async function requireAdmin(next: string): Promise<CurrentUser> {
  const user = await requireUser(next);
  if (user.role !== "admin") redirect("/ledger");
  return user;
}
