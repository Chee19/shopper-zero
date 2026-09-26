import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { createCheckoutService } from "./service";
import { registerCheckoutTools, toolResult } from "./mcp-tools";
import { CheckoutError } from "./errors";

export function createMockMcpServer(service: ReturnType<typeof createCheckoutService>) {
  const server = new McpServer({ name: "shopperzero-mock-checkout", version: "0.1.0" });
  registerCheckoutTools(server, service);
  server.registerTool("search_catalog", {
    description: "Search the local mock catalog. This is demo data, not a live merchant index.",
    inputSchema: { query: z.string().max(200).optional() }, annotations: { readOnlyHint: true },
  }, ({ query }) => toolResult(async () => ({ simulated: true,
    products: (await service.catalog()).filter(p => !query || `${p.title} ${p.variant_title}`.toLowerCase().includes(query.toLowerCase())) })));
  server.registerTool("get_product", {
    description: "Read a local mock variant by its variant id.", inputSchema: { id: z.string().uuid() }, annotations: { readOnlyHint: true },
  }, ({ id }) => toolResult(async () => {
    const product = (await service.catalog()).find(p => p.id === id);
    if (!product) throw new CheckoutError("not_found", "Mock product not found.", 404);
    return { simulated: true, ...product };
  }));
  return server;
}
