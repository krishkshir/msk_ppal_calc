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
