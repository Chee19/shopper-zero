import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  // Mock mode (WS5) and envs without Supabase must still render UI pages.
  if (
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
