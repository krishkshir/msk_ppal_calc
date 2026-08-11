import { redirect } from "next/navigation";
import { createClient } from "@/lib/db/supabase-server";

export interface CurrentUser {
  id: string;
  email: string | null;
  role: "admin" | "user";
}

/**
 * Null when signed out. Uses getClaims() (JWT-verified) rather than
 * getSession() to establish identity, matching current Supabase SSR
 * guidance — see src/proxy.ts for the same reasoning.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) {
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.claims.sub)
    .single();

  return {
    id: data.claims.sub,
    email: data.claims.email ?? null,
    role: profile?.role === "admin" ? "admin" : "user",
  };
}

/** Redirects to /login?next=<next> if signed out, otherwise returns the signed-in user. */
export async function requireUser(next: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${next}`);
  return user;
}

/** Redirects to /login?next=<next> if signed out or not an admin, otherwise returns the signed-in admin. */
export async function requireAdmin(next: string): Promise<CurrentUser> {
  const user = await requireUser(next);
  if (user.role !== "admin") redirect(`/login?next=${next}`);
  return user;
}
