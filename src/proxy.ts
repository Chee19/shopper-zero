import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Skip static assets and the public agent-facing API (stateless, no session).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/agent|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
