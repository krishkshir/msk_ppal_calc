import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Refreshes the Supabase session cookie on every request and gates
 * /ledger* — the only routes that require a signed-in account. / and
 * /breakdown stay public (clients open /breakdown links with no login),
 * so gating is route-level here, never Vercel deployment protection over
 * the whole site — see docs/plan-v0.5.html "Routes".
 *
 * This checks authentication only — is there a valid session — never
 * identity or role. WHO may hold a session at all (the
 * krish.kshir@gmail.com / karendlima3@gmail.com / shrikantkshirsagar29@gmail.com
 * allow-list) is enforced in the database, at account-creation time
 * (handle_new_user, supabase/migrations/20260811090000_allowed_accounts.sql)
 * and again in every RLS policy; role (admin vs. user) is enforced by
 * src/lib/auth/profile.ts's requireUser/requireAdmin plus RLS. See
 * docs/plan-ledger-access-lockdown.html.
 *
 * Named `proxy.ts`, not `middleware.ts` — this Next.js version (16)
 * renamed the file convention; see node_modules/next/dist/docs
 * "Migration to Proxy".
 *
 * Uses getClaims() rather than getSession() to decide whether a request
 * is authenticated: getSession() only reads the (possibly stale or
 * tampered) local cookie, while getClaims() validates the JWT signature
 * against the project's published keys every time — current Supabase SSR
 * guidance is to never trust getSession() for this decision.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request: { headers: request.headers } });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Must run before any response is returned — a token refresh completing
  // after the response is committed can't be written back to cookies.
  const { data, error } = await supabase.auth.getClaims();

  if ((error || !data) && request.nextUrl.pathname.startsWith("/ledger")) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
