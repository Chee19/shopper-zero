// src/lib/mcp/instrument.ts  (WS3)
// Wraps every registerTool call on the server (catalog, crawl and checkout registrars alike) with the
// rate limit and exactly one agent_requests row per tool call. Registrars must NOT log themselves (CR-2).
import "server-only";
import { logHit } from "@/features/catalog/log";
import { rateLimit } from "@/features/catalog/ratelimit";
import { AppError } from "@/shared/errors";
import { toolError } from "./result";
import type { McpServer } from "./types";

/** Tools that start crawls or browser sessions. */
const EXPENSIVE = new Set(["index_store", "scan_store"]);

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Best-effort store attribution from any registrar's structuredContent. */
export function storeIdOf(sc: any): string | null {
  return (
    sc?.store?.id ??
    sc?.store_id ??
    sc?.product?._shoperzero?.store?.id ??
    sc?.products?.[0]?._shoperzero?.store?.id ??
    null
  );
}

type ToolCallback = (args: any, ctx: any) => unknown;

export function instrumentServer(server: McpServer): McpServer {
  const orig = server.registerTool.bind(server) as (name: string, config: unknown, cb: ToolCallback) => unknown;
  // Own-property override (not a Proxy) so SDK internals keep their `this`.
  (server as any).registerTool = (name: string, config: unknown, cb: ToolCallback) =>
    orig(name, config, async (args: any, sdkCtx: any) => {
      const req: Request | null = sdkCtx?.http?.req ?? null;
      const agentProfile: string | null = args?.meta?.["ucp-agent"]?.profile ?? null;
      // Rejected calls are not logged: a runaway loop must not also hammer agent_requests.
      if (!rateLimit(req, EXPENSIVE.has(name) ? "expensive" : "read")) {
        return toolError(new AppError("rate_limited", "Too many requests from this client. Wait 60 seconds and retry."), name);
      }
      let result: any;
      try {
        result = await cb(args, sdkCtx);
        return result;
      } catch (err) {
        // Registrars should never throw; this is the safety net.
        result = toolError(err, name);
        return result;
      } finally {
        logHit("mcp", { tool: name, req, storeId: storeIdOf(result?.structuredContent), agentProfile });
      }
    });
  return server;
}
