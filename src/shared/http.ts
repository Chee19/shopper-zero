// src/shared/http.ts  (server-only)
import "server-only";
import type { NextRequest } from "next/server";
import type { z } from "zod";
import type { ApiErrorBody } from "@/contracts";
import { AppError, toAppError } from "@/shared/errors";
import { log } from "@/shared/log";

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "content-type, authorization, idempotency-key, ucp-agent, request-id, payment-signature, x-payment, mcp-session-id, mcp-protocol-version, last-event-id",
  "Access-Control-Expose-Headers": "request-id, payment-required, payment-response, x-payment-response, mcp-session-id",
  "Access-Control-Max-Age": "86400",
};

export function getRequestId(req: Request): string {
  return req.headers.get("request-id") ?? req.headers.get("x-request-id") ?? crypto.randomUUID();
}

/** JSON response with CORS + Request-Id headers. */
export function json(data: unknown, init: ResponseInit & { requestId?: string } = {}): Response {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  if (init.requestId) headers.set("Request-Id", init.requestId);
  return Response.json(data, { status: init.status ?? 200, headers });
}

/** Plain text / other content types (llms.txt, jsonl) with CORS. */
export function text(body: string, contentType = "text/plain; charset=utf-8", init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  headers.set("Content-Type", contentType);
  return new Response(body, { status: init.status ?? 200, headers });
}

/** Error envelope. Unknown errors are logged with stack and returned as "internal". */
export function errorResponse(err: unknown, requestId?: string): Response {
  const e = toAppError(err);
  if (e.code === "internal") log.error("http.unhandled", err, { request_id: requestId });
  const body: ApiErrorBody = {
    error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}), request_id: requestId },
  };
  return json(body, { status: e.status, requestId });
}

/** `export const OPTIONS = preflight;` in every public route file. */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function parseJsonBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new AppError("bad_request", "Body must be valid JSON");
  }
  return schema.parse(raw); // ZodError -> validation_error via toAppError
}

/** Query string -> object (repeated keys become arrays) -> schema. Use z.coerce for numbers/booleans. */
export function parseSearchParams<S extends z.ZodType>(req: Request, schema: S): z.output<S> {
  const obj: Record<string, string | string[]> = {};
  for (const [k, v] of new URL(req.url).searchParams) {
    const prev = obj[k];
    obj[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return schema.parse(obj);
}

/** Wraps a route handler: request id, error envelope, timing log. */
export function route<Ctx>(
  name: string,
  handler: (req: NextRequest, ctx: Ctx, meta: { requestId: string }) => Promise<Response>,
): (req: NextRequest, ctx: Ctx) => Promise<Response> {
  return async (req, ctx) => {
    const requestId = getRequestId(req);
    const started = Date.now();
    try {
      let res = await handler(req, ctx, { requestId });
      if (!res.headers.has("Request-Id")) {
        try {
          res.headers.set("Request-Id", requestId);
        } catch {
          // Response.redirect() / fetch() responses have immutable headers.
          res = new Response(res.body, res);
          // fetch() already decoded the body; forwarding these would corrupt it.
          res.headers.delete("content-encoding");
          res.headers.delete("content-length");
          res.headers.set("Request-Id", requestId);
        }
      }
      log.info("http.request", { route: name, method: req.method, status: res.status, ms: Date.now() - started, request_id: requestId });
      return res;
    } catch (err) {
      const res = errorResponse(err, requestId);
      log.warn("http.request", { route: name, method: req.method, status: res.status, ms: Date.now() - started, request_id: requestId });
      return res;
    }
  };
}
