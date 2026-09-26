import { createMcpHandler } from "mcp-handler";
import { mcpPreflight, withCors } from "@/features/catalog/http";
import { getRequestId } from "@/shared/http";
import { registerCheckoutTools } from "@/features/checkout/mcp-tools"; // WS4: 5 checkout tools + get_order
import { getMockService } from "@/features/checkout/runtime"; // WS4: simulated checkout service (Stripe-only MVP)
import { registerCrawlTools } from "@/features/crawl/mcp-tools"; // WS2: index_store, get_crawl_status, scan_store, get_scan
import { instrumentServer } from "@/infrastructure/mcp/instrument"; // WS3: rate limit + agent_requests for every tool
import { MCP_INSTRUCTIONS } from "@/infrastructure/mcp/instructions";
import type { McpServer } from "@/infrastructure/mcp/types";
import { registerCatalogTools } from "@/infrastructure/mcp/tools/catalog"; // WS3

export const maxDuration = 300; // B8: crawl/scan tools schedule work with after()

/** Compose the checkout feature into the shared MCP v2 server when the demo is enabled. */
function composeCheckoutTools(server: McpServer) {
  let service: ReturnType<typeof getMockService>;
  try {
    service = getMockService();
  } catch {
    return;
  }
  registerCheckoutTools(server, service);
}

const handler = createMcpHandler(
  (server) => {
    instrumentServer(server); // MUST run first: wraps every registerTool call below
    registerCatalogTools(server);
    registerCrawlTools(server);
    composeCheckoutTools(server);
  },
  {
    serverInfo: { name: "shoperzero", version: "0.1.0" },
    instructions: MCP_INSTRUCTIONS,
    verboseLogs: process.env.NODE_ENV !== "production",
  },
);

async function handle(req: Request): Promise<Response> {
  return withCors(await handler(req), getRequestId(req));
}

// Stateless Streamable HTTP: GET and DELETE answer 405 from the handler, which clients handle.
export { handle as DELETE, handle as GET, handle as POST };
export const OPTIONS = mcpPreflight;
