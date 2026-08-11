import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server Component / Server Action client. Never uses the service-role
 * key — every read/write in this app goes through RLS as the
 * authenticated (or anonymous) caller, matching the Supabase security
 * checklist's "never expose service_role" guidance by simply never
 * reaching for it (see supabase/migrations for the policies this relies on).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies() is
            // read-only — src/proxy.ts already refreshes the session for
            // this request, so it's safe to no-op here.
          }
        },
      },
    },
  );
}
