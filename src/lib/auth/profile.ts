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
 * Role comes from `my_ledger_role()`, a SECURITY DEFINER RPC
 * (supabase/migrations/20260811120000_derive_ledger_access.sql) that
 * derives membership live from `public.allowed_accounts` joined to
 * `auth.users` — there is no longer a `profiles` table to go stale. An
 * earlier version of this function read a `profiles` row directly through
 * ordinary RLS, which (a) fell through to `role: "user"` on a missing row
 * — a fail-OPEN bug, `.single()`'s zero-row error was silently discarded —
 * and (b) coupled this read to `profiles`' own SELECT policy, exactly the
 * fragility the RPC helpers were introduced elsewhere to avoid. The RPC
 * call fixes both at once.
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

  const { data: role, error: roleError } = await supabase.rpc("my_ledger_role");

  if (roleError) {
    // A transient DB failure, not a real allow-list decision — fail
    // closed the same as "anonymous" (redirect to plain sign-in) rather
    // than telling a legitimate user they're not permitted. Logged
    // because this branch is otherwise indistinguishable from a
    // signed-out visitor from the outside: the session is still valid, so
    // the /login bounce would look inexplicable without this.
    console.error("my_ledger_role() failed", roleError);
    return { kind: "anonymous" };
  }
  if (!role) {
    return { kind: "not_permitted" };
  }

  return {
    kind: "ok",
    user: {
      id: data.claims.sub,
      email: data.claims.email ?? null,
      role: role === "admin" ? "admin" : "user",
    },
  };
}

/**
 * Null when signed out or not allow-listed — see resolveUser's doc
 * comment for the actual check. No call sites currently (requireUser is
 * what every route/action uses instead); kept as the non-redirecting
 * counterpart for any future caller that needs to know who's signed in
 * without bouncing them.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const resolved = await resolveUser();
  return resolved.kind === "ok" ? resolved.user : null;
}

/**
 * Whether the request carries a valid session at all, regardless of
 * allow-list membership — a getClaims()-only check, no RPC round trip.
 * Used by /login (src/app/login/page.tsx) to always offer a sign-out
 * affordance to a signed-in-but-unlisted visitor, not only when they
 * arrive via requireUser's `?error=no_access` redirect (e.g. someone who
 * bookmarks /login directly, or whose access was revoked mid-session).
 */
export async function hasSession(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  return !error && data != null;
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

/**
 * Redirects a signed-out or not-permitted visitor to /login; redirects a
 * signed-in non-admin to `/ledger?error=not_admin` — a visible banner
 * there (src/app/ledger/page.tsx), not a silent bounce indistinguishable
 * from the admin-only action having simply had no effect.
 */
export async function requireAdmin(next: string): Promise<CurrentUser> {
  const user = await requireUser(next);
  if (user.role !== "admin") redirect("/ledger?error=not_admin");
  return user;
}
