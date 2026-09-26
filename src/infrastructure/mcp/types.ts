// src/infrastructure/mcp/types.ts  (WS1 creates at T+30; WS3 owns)
import type { createMcpHandler } from "mcp-handler";
/** The server object mcp-handler passes to its init callback (has registerTool). */
export type McpServer = Parameters<Parameters<typeof createMcpHandler>[0]>[0];
export type ToolRegistrar = (server: McpServer) => void;
// UNVERIFIED against mcp-handler 2.2.0 typings. Fallback:
//   import type { McpServer } from "@modelcontextprotocol/server";
