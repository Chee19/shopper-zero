import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/infrastructure/supabase/proxy";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const mockCheckoutPage = path === "/demo/checkout" || path.startsWith("/checkouts/");
  // Mock mode (WS5), checkout demo pages, and envs without Supabase must still render.
  // API routes are already excluded by the matcher below.
  if (
    mockCheckoutPage ||
    process.env.NEXT_PUBLIC_UI_MOCK === "1" ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    return NextResponse.next({ request });
  }
  return updateSession(request);
}

export const config = {
  // Refresh the Supabase session only for human UI pages. Skipped: static assets, every API
  // route (api/*), per-store agent outputs (s/*) and root discovery files; none use cookies.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/|s/|\\.well-known/|llms\\.txt|robots\\.txt|openapi\\.json|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
