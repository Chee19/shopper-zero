import { createMcpHandler } from "mcp-handler";
import { mcpPreflight, withCors } from "@/lib/agent/http";
import { getRequestId } from "@/lib/http";
import type { McpServer as SdkV1McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCheckoutTools } from "@/lib/checkout/mcp-tools"; // WS4: 5 checkout tools + get_order
import { getMockService } from "@/lib/checkout/runtime"; // WS4: simulated checkout service (Stripe-only MVP)
import { registerCrawlTools } from "@/lib/crawl/mcp-tools"; // WS2: index_store, get_crawl_status, scan_store, get_scan
import { instrumentServer } from "@/lib/mcp/instrument"; // WS3: rate limit + agent_requests for every tool
import { MCP_INSTRUCTIONS } from "@/lib/mcp/instructions";
import type { McpServer } from "@/lib/mcp/types";
import { registerCatalogTools } from "@/lib/mcp/tools/catalog"; // WS3

export const maxDuration = 300; // B8: crawl/scan tools schedule work with after()

/**
 * WS4's registrar takes its service and is typed against the SDK v1 McpServer with raw zod shapes.
 * The v2 server accepts raw shapes (it wraps them in z.object), so only the type differs. Checkout tools
 * are registered only while WS4's runtime provides a service (mock mode); otherwise the catalog and
 * crawl tools still serve and checkout is simply absent from tools/list.
 */
function composeCheckoutTools(server: McpServer) {
  let service: ReturnType<typeof getMockService>;
  try {
    service = getMockService();
  } catch {
    return;
  }
  registerCheckoutTools(server as unknown as SdkV1McpServer, service);
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
