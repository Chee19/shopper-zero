import { AppError } from "@/lib/errors";
import { json, route } from "@/lib/http";
import { getCheckoutView } from "@/app/(site)/_lib/queries";
import { redactCheckout } from "@/components/checkout/redact";

/**
 * UI-only (not agent-facing, not in openapi.json). checkout_events is private (DECISIONS C9), so the timeline polls
 * this route: the checkout (PII redacted server-side) plus its events, read with the service-role helpers.
 */
export const GET = route<RouteContext<"/api/v1/ui/checkouts/[id]">>("ui.checkout", async (_req, ctx, { requestId }) => {
  const { id } = await ctx.params;
  const view = await getCheckoutView(id);
  if (!view || (!view.checkout && view.events.length === 0)) throw new AppError("not_found", "Checkout not found");
  return json(
    { checkout: redactCheckout(view.checkout), events: view.events },
    { requestId, headers: { "Cache-Control": "no-store" } },
  );
});
