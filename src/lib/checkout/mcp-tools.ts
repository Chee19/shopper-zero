import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CompleteCheckoutInputSchema, CreateCheckoutInputSchema, UpdateCheckoutInputSchema, type CheckoutService, type RequestContext } from "./contracts";
import { CheckoutError } from "./errors";

const id = z.string().uuid();
const meta = z.record(z.string(), z.unknown()).optional();
const key = z.string().min(1).max(255).optional();
const line = z.union([
  z.object({ variant_id: id, quantity: z.number().int().min(1).max(20) }),
  z.object({ item: z.object({ id: z.string().regex(/^(sz:variant:)?[0-9a-f-]{36}$/i) }), quantity: z.number().int().min(1).max(20) }),
]);
const createSchema = CreateCheckoutInputSchema.extend({ line_items: z.array(line).min(1).max(20) });
const updateSchema = UpdateCheckoutInputSchema.extend({ line_items: z.array(line).min(1).max(20).optional() });
function lines(input: z.infer<typeof createSchema> | z.infer<typeof updateSchema>) {
  return { ...input, line_items: input.line_items?.map(l => ({ variant_id: "variant_id" in l ? l.variant_id : l.item.id.replace(/^sz:variant:/, ""), quantity: l.quantity })) };
}
const ctx = (idempotency_key?: string): RequestContext => ({ surface: "mcp", request_id: randomUUID(), idempotency_key });
export async function toolResult(fn: () => Promise<unknown>) {
  try {
    const data = await fn();
    return { content: [{ type: "text" as const, text: JSON.stringify(data) }], structuredContent: data as Record<string, unknown> };
  } catch (error) {
    const data = { error: { code: error instanceof CheckoutError ? error.code : "internal_error", message: error instanceof CheckoutError ? error.message : "Checkout tool failed." } };
    return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(data) }], structuredContent: data };
  }
}
/** Allen can compose these six tools into the shared MCP server without duplicating service logic. */
export function registerCheckoutTools(server: McpServer, service: CheckoutService) {
  server.registerTool("create_checkout", { description: "Create a simulated checkout. No real vendor calls or charges.", inputSchema: { checkout: createSchema, idempotency_key: key, meta }, annotations: { idempotentHint: true, destructiveHint: false } },
    ({ checkout, idempotency_key }) => toolResult(() => service.createCheckout(CreateCheckoutInputSchema.parse(lines(checkout)), ctx(idempotency_key))));
  server.registerTool("update_checkout", { description: "Update buyer, address or cart before payment.", inputSchema: { id, checkout: updateSchema, meta }, annotations: { destructiveHint: false } },
    ({ id, checkout }) => toolResult(() => service.updateCheckout(id, UpdateCheckoutInputSchema.parse(lines(checkout)), ctx())));
  server.registerTool("get_checkout", { description: "Retrieve the persisted simulated checkout.", inputSchema: { id, meta }, annotations: { readOnlyHint: true } },
    ({ id }) => toolResult(() => service.getCheckout(id)));
  server.registerTool("complete_checkout", { description: "Confirm the buyer-approved demo purchase using credential token mock_card_visa. Payments and orders are simulated.", inputSchema: { id, checkout: CompleteCheckoutInputSchema, meta }, annotations: { destructiveHint: true, idempotentHint: true } },
    ({ id, checkout }) => toolResult(() => service.completeCheckout(id, checkout, ctx(checkout.idempotency_key))));
  server.registerTool("cancel_checkout", { description: "Cancel a pending simulated checkout.", inputSchema: { id, meta }, annotations: { destructiveHint: true, idempotentHint: true } },
    ({ id }) => toolResult(() => service.cancelCheckout(id, ctx())));
  server.registerTool("get_order", { description: "Retrieve the simulated merchant order and payment references.", inputSchema: { id, meta }, annotations: { readOnlyHint: true } },
    ({ id }) => toolResult(() => service.getOrder(id)));
}
