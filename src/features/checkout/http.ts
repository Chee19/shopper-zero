import { randomUUID } from "node:crypto";
import { CheckoutError } from "@/features/checkout/errors";
import type { RequestContext } from "@/features/checkout/contracts";

export function context(request: Request): RequestContext {
  return { surface: "rest", request_id: randomUUID(), idempotency_key: request.headers.get("Idempotency-Key") ?? undefined };
}
export async function body(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new CheckoutError("validation_error", "Use application/json.", 415);
  const text = await request.text();
  if (text.length > 65_536) throw new CheckoutError("validation_error", "Request body is too large.", 413);
  try { return JSON.parse(text); }
  catch { throw new CheckoutError("validation_error", "Malformed JSON."); }
}
export async function route(fn: () => Promise<unknown>, status = 200) {
  try { return Response.json(await fn(), { status, headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    const known = error instanceof CheckoutError;
    if (!known) console.error("Mock checkout failed:", error instanceof Error ? error.name : "unknown error");
    return Response.json({ error: { code: known ? error.code : "internal_error", message: known ? error.message : "The mock checkout could not finish.", request_id: randomUUID() } },
      { status: known ? error.status : 500, headers: { "Cache-Control": "no-store" } });
  }
}
