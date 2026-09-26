import { json, route } from "@/lib/http";
import { getLatestCheckoutId } from "@/app/(site)/_lib/queries";

/** UI-only: the newest checkout's id for /checkouts/live follow mode (null until one exists). */
export const GET = route<unknown>("ui.checkout.latest", async (_req, _ctx, { requestId }) => {
  return json({ checkout_id: await getLatestCheckoutId() }, { requestId, headers: { "Cache-Control": "no-store" } });
});
