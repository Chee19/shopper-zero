import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMockMcpServer } from "@/lib/checkout/mcp-server";
import { getMockService } from "@/lib/checkout/runtime";
import { CheckoutError } from "@/lib/checkout/errors";

// Stateless, JSON-only transport. Shared WS3 server can compose registerCheckoutTools later.
export async function POST(request: Request) {
  let service;
  try { service = getMockService(); }
  catch (error) { return Response.json({ error: error instanceof CheckoutError ? error.message : "Unavailable" }, { status: 503 }); }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return new Response("Origin not allowed", { status: 403 });
  const server = createMockMcpServer(service);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 65_536 });
  await server.connect(transport);
  try { return await transport.handleRequest(request); }
  finally { await server.close(); }
}
export async function GET() { return new Response("Use POST for the stateless mock MCP endpoint.", { status: 405, headers: { Allow: "POST" } }); }
export async function DELETE() { return new Response(null, { status: 405, headers: { Allow: "POST" } }); }
