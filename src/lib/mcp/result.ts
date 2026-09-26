// src/lib/mcp/result.ts  (WS1 creates at T+30; WS3 owns)
import "server-only";
import type { ToolResult } from "@/lib/contracts";
import { toAppError } from "@/lib/errors";
import { log } from "@/lib/log";

/**
 * Success result. The text block carries a one-line summary PLUS the compact JSON, because
 * some MCP clients only show `content` to the model (MCP spec: structured results SHOULD
 * also be serialized in a text block).
 */
export function toolResult(structured: object, summary: string): ToolResult {
  return {
    content: [{ type: "text", text: `${summary}\n${JSON.stringify(structured)}` }],
    structuredContent: structured as Record<string, unknown>,
  };
}

/** Error result (never throw out of a tool handler). Same envelope as REST: { error: {code, message, details?} }. */
export function toolError(err: unknown, tool?: string): ToolResult {
  const e = toAppError(err);
  if (e.code === "internal") log.error("mcp.tool.unhandled", err, { tool });
  const body = { error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}) } };
  return { isError: true, content: [{ type: "text", text: `${e.code}: ${e.message}` }], structuredContent: body };
}
