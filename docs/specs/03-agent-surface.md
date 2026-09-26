# 03 — WS3 Agent surface: MCP server, REST read API, index outputs, discovery

Implementation spec for workstream 3. It is written so a coding agent can build it top to bottom without asking questions. **Precedence:** `docs/specs/DECISIONS.md` (binding), then `00-overview-and-contracts.md` (canonical contracts, conventions and shared helpers), then this file. Background: `docs/research/00-SYNTHESIS.md`, `06-agent-index-and-discoverability.md`, `01-agentic-commerce-protocols.md`. If this file disagrees with 00 or DECISIONS, they win; report the mismatch.

Markers: **VERIFIED** = checked on 2026-09-26 against a live endpoint, the npm registry, or a local run of Next 16.3.6. **UNVERIFIED** = not confirmed; a fallback is given.

## Round-2 changes (DECISIONS.md)

- **B1:** WS3 no longer touches `src/app/api/v1/stores/route.ts`. WS2 owns both GET (list) and POST there. WS3 owns `src/app/api/v1/stores/[slug]/route.ts`. The `stores-list.ts` re-export and old CR-4 are gone.
- **B4:** `index_store` and `get_crawl_status`, plus the new `scan_store` and `get_scan`, belong to WS2's `registerCrawlTools(server)` (`src/features/crawl/mcp-tools.ts`). §4.5 keeps only a reference. `/api/mcp` composes three registrars: catalog (WS3, `src/infrastructure/mcp/tools/catalog.ts`), crawl (WS2) and checkout (WS4, `src/features/checkout/mcp-tools.ts`, including `get_order`). One WS3 logging and rate-limit wrapper covers all three (§3.3). That makes 14 tools.
- **B7 (accepted):** MCP and REST return the UCP product shape by default. Raw `IndexedProduct` is available at `?format=indexed`. `structuredContent` equals the REST body.
- **B8 (accepted):** `/api/mcp` has `maxDuration = 300`.
- **B10:** agent-checkout status comes from WS4's `resolveCheckoutConnector(store)`.
- **B11/B12:** errors use 00's `AppError` codes and envelope `{error:{code,message,details?}}`. DB access uses 00 §6.10's helpers: `resolveStore`, `getProduct` (ref forms), `lookupProducts`, `listStoreProducts({limit,page})`, `searchProducts(SearchParams)`, `listStores`, `getLatestCrawlRun`, `getIndexStats`, `getLatestScanForStore`. WS3's private resolvers, id parser and `stores.opted_out` handling were removed.
- **Aligned to 00:**
  - WS1's shared helpers `src/shared/http.ts`, `errors.ts`, `log.ts`, `env.ts` and `money.ts`.
  - `toolResult`/`toolError` in `src/infrastructure/mcp/result.ts`.
  - ISO timestamps with milliseconds, also in the Shopify-compat output.
  - Plain uuids; the `sz:` prefixes are removed.
  - `total_count` in search pagination.
  - The `categories` filter is supported.
  - `UCP_SUPPORTED_VERSIONS` comes from contracts.
- **Scan and score (optional, minimal):** per-store llms.txt, the root llms.txt store list, the per-store UCP profile (a sibling `_shoperzero` key outside `ucp`) and `GET /api/v1/stores/{slug}` can show the store's scan grade, `best_method` and a scan-report link. They show them only when that data exists (§6.5, §6.6, §7.3).
- **Removed:**
  - the WS3 checkout stub (WS1 ships the T+30 stubs; WS4 owns the file);
  - `toStoreSummary`/`storeUrls` (00's `StoreSummary` and `Store.urls` are used as-is);
  - the self-call and SSRF sections of `index_store` (now WS2's).

---

## 0. What was verified today (read before coding)

| Fact | How verified |
|---|---|
| `mcp-handler@2.2.0` (latest) peers: `next >=13`, `@modelcontextprotocol/server ^2.0.0`. `@modelcontextprotocol/server@2.1.0`, `zod@4.6.5`, `@modelcontextprotocol/sdk@1.30.1`, `mcp-handler@1.1.0` (peer `@modelcontextprotocol/sdk@1.26.0`), `mcp-remote@0.14.3`, `@modelcontextprotocol/inspector@2.8.0` | `npm view` |
| `createMcpHandler(init, options)` returns `(req: Request) => Promise<Response>`. `server.registerTool(name, { title, description, inputSchema: z.object(...), annotations }, async (args, ctx) => ...)` works. `ctx.http?.req` is the original `Request` (user-agent readable). `options.instructions` is returned on `initialize`. | Local run in a Next 16.3.6 sandbox app (`next dev` + `next build`) |
| Stateless: `tools/list` and `tools/call` work **without** a prior `initialize`. Responses are `text/event-stream` (`event: message` / `data: {...}`). `POST` without `Accept: application/json, text/event-stream` → **406**. `GET` → **405**. | Same sandbox, curl |
| zod validation failure → normal JSON-RPC result with `isError: true` and text `Input validation error: ...`. A thrown error → `isError: true` with the error message as text (so never throw raw internals). | Same sandbox |
| zod unions, `z.looseObject`, `.describe()`, `.default()`, even `.transform()` all serialize into the tool's JSON Schema. | Same sandbox |
| `after()` from `next/server` called inside an MCP tool callback runs after the response. | Same sandbox (`AFTER_RAN` logged) |
| Folder names with dots are normal static segments: `app/llms.txt/route.ts`, `app/.well-known/ucp/route.ts`, `app/s/[slug]/products.json/route.ts`, `app/s/[slug]/feed.acp.jsonl/route.ts`, `app/s/[slug]/.well-known/ucp/route.ts` all serve 200. | Sandbox `next dev` + `next build` (all listed as `ƒ` dynamic routes) |
| `app/s/[slug]/products/[handle]/route.ts` receives `/s/x/products/blue-hoodie.json` as `handle = "blue-hoodie.json"` (dots kept). Next has no `[handle].json` partial-segment syntax. | Sandbox |
| `RouteContext<'/s/[slug]/products.json'>` type-checks in `next build`. Route handlers are dynamic by default (no `cacheComponents` in our `next.config.ts`, so do **not** use `'use cache'`). | Sandbox build; `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`, `.../01-directives/use-cache.md` |
| `app/robots.ts` supports `rules[].other` (added v16.3.0) → emits `Content-Signal: search=yes, ai-input=yes, ai-train=no` inside the `User-Agent: *` group. It is prerendered static (`○`). | Docs `03-file-conventions/01-metadata/robots.md` + sandbox output |
| Live Shopify UCP profile shape (`https://www.allbirds.com/.well-known/ucp`), response headers `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=60`, `Link: </.well-known/ucp>; rel="ucp"; version="2026-08-25"` | curl |
| Live Shopify UCP MCP (`weareallbirds.myshopify.com/api/ucp/mcp`): tool descriptions, `search_catalog` input JSON Schema, and real `search_catalog` / `get_product` / `lookup_catalog` output shapes (§4). Passing any fetchable UCP profile URL as `meta.ucp-agent.profile` is accepted. | curl `tools/list` + `tools/call` |
| Shopify `products.json` paging: default limit 30; `limit` < 1 or non-numeric → 30; `limit` > 250 → 250; `page` < 1 or non-numeric → 1; page past the end → `{"products":[]}`; `page*limit > 25000` → **HTTP 400** `{"errors":"Page * Limit exceeds the 25000 limit."}` | curl allbirds |
| Shopify `/products/{handle}.json` key set (differs from the list shape: `tags` is a comma-joined **string**, no `available`, extra variant keys) | curl allbirds |
| ACP/OpenAI feed: `price` = `"18.00 USD"`; `availability` ∈ `in_stock|out_of_stock|pre_order|backorder|unknown`; `variant_dict` object; `additional_image_urls` array; `sale_price` must be `< price`; omit unknown fields, never `"null"` | developers.openai.com/commerce/specs/feed |
| A2A latest is v1.0.0: Agent Card requires `supportedInterfaces[{url, protocolBinding, protocolVersion}]` | a2a-protocol.org/latest/specification |
| `claude mcp add --transport http <name> <url>` | `claude mcp add --help` |
| Inspector v2 CLI: `--cli --transport http --server-url <url> --method tools/call --tool-name X --tool-args-json '{...}'`; needs Node ≥ 22.19 (repo `.nvmrc` = 22) | package tarball |

---

## 1. Scope, ownership, dependencies

### 1.1 Scope

Everything an agent reads:
- the MCP server route, which composes three registrars;
- the catalog MCP tools;
- the REST read API (search, product, one store);
- the Shopify-compatible and ACP index outputs;
- `llms.txt`, UCP profiles, the agent card, OpenAPI and `robots.txt`;
- agent-request logging and rate limiting for all MCP tools.

### 1.2 Files WS3 owns (create exactly these)

```
src/app/api/mcp/route.ts                          MCP endpoint; composes catalog + crawl + checkout registrars
src/app/api/v1/search/route.ts                    GET search (REST twin of search_catalog)
src/app/api/v1/products/[id]/route.ts             GET product (REST twin of get_product)
src/app/api/v1/stores/[slug]/route.ts             GET one store (+ latest crawl run, latest scan)
src/app/s/[slug]/products.json/route.ts           Shopify-compatible list
src/app/s/[slug]/products/[handle]/route.ts       Shopify-compatible single ({handle}.json)
src/app/s/[slug]/feed.acp.jsonl/route.ts          ACP feed, one row per variant
src/app/s/[slug]/llms.txt/route.ts                per-store llms.txt
src/app/s/[slug]/.well-known/ucp/route.ts         per-store UCP profile
src/app/llms.txt/route.ts                         root llms.txt
src/app/.well-known/ucp/route.ts                  root UCP profile
src/app/.well-known/ucp/[version]/route.ts        versioned root profile (UCP_SUPPORTED_VERSIONS minus current)
src/app/.well-known/agent-card.json/route.ts      A2A-style discovery card
src/app/openapi.json/route.ts                     OpenAPI 3.1 for /api/v1
src/app/robots.ts                                 robots.txt + Content-Signal

src/infrastructure/mcp/types.ts          McpServer, ToolRegistrar (WS1 stub at T+30, 00 §6.9; WS3 owns)
src/infrastructure/mcp/result.ts         toolResult(), toolError() (WS1 stub at T+30, verbatim 00 §6.9; WS3 owns)
src/infrastructure/mcp/instrument.ts     instrumentServer(): rate limit + agent_requests logging for EVERY tool
src/infrastructure/mcp/instructions.ts   MCP_INSTRUCTIONS string
src/infrastructure/mcp/tools/catalog.ts  registerCatalogTools: list_stores, search_catalog, lookup_catalog, get_product

src/features/catalog/formats/shopify.ts    toShopifyListProduct, toShopifyDetailProduct, parseShopifyPaging
src/features/catalog/formats/ucp.ts        toUcpProduct, ucpEnvelope, buildUcpProfile
src/features/catalog/formats/acp.ts        toAcpRows
src/features/catalog/formats/llms.ts       renderRootLlmsTxt, renderStoreLlmsTxt
src/features/catalog/formats/permalink.ts  cartPermalink (merchant add-to-cart / PDP link shown on variants)
src/features/catalog/formats/openapi.ts    buildOpenApi(base)
src/features/catalog/formats/agent-card.ts buildAgentCard(base)
src/features/catalog/formats/text.ts       stripHtml, escapeHtml, truncate, plainDescription, isAvailable

src/features/catalog/http.ts         CACHE presets, storeCache(), ucpLinkHeader(), withCors() (MCP streams), mcpPreflight()
src/features/catalog/log.ts          logHit() → after(() => logAgentRequest(...))
src/features/catalog/ratelimit.ts    best-effort in-memory limiter
src/features/catalog/search.ts       catalogSearch() (shared by MCP + REST)
src/features/catalog/verify.ts       verifyVariants() around WS2's verifyOffer
src/features/catalog/checkout-status.ts  CHECKOUT_TOOLS_LIVE switch, enabledRails(), agentCheckoutFor()
src/features/catalog/scan-info.ts    scanInfo(store): optional scan grade / best_method / report URL
```

`src/features/catalog/**` and the `src/features/catalog/formats/*` files beyond `shopify/ucp/acp`, as well as `.well-known/ucp/[version]`, are WS3 additions (CR-3). Do **not** add a `page.tsx` under `src/app/s/`: a `page` and a `route` cannot share a segment, and human pages are WS5's `/stores/{slug}` and `/scan/{id}`.

### 1.3 Files WS3 must not edit

- WS1: `src/proxy.ts`, `src/contracts/**`, `src/infrastructure/database/**`, `src/shared/{errors,http,log,env,money,slug}.ts`, `package.json`, `next.config.ts`.
- WS2: `src/app/api/v1/stores/route.ts` (GET list and POST, per B1), `src/app/api/v1/crawl-runs/**`, `src/app/api/v1/scans/**`, `src/features/crawl/**` (including `mcp-tools.ts`), `src/features/scan/**`, `src/features/scan/readiness/**`.
- WS4: `src/features/checkout/**` (including `mcp-tools.ts`), `src/features/checkout/payments/**`, `src/app/api/v1/checkouts/**`, `src/app/api/v1/orders/**`, `src/app/api/demo-wallet/**`.

### 1.4 What WS3 consumes

**Contracts** (`@/lib/contracts`, 00 §6): `Money, Platform, CheckoutConnectorId, PaymentRailId, AgentSurface, UCP_VERSION, UCP_SUPPORTED_VERSIONS, ACP_VERSION, PAYMENT_HANDLER_IDS, SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT, LOOKUP_MAX_IDS, LIST_STORES_MAX_LIMIT, PRODUCTS_JSON_DEFAULT_LIMIT, PRODUCTS_JSON_MAX_LIMIT, Offer, IndexedVariant, IndexedProduct, ProductSummary, SearchParams, SearchResult, Store, StoreSummary, StoreRef, CrawlRun, ReadinessGrade, ToolResult, UcpMetaSchema, ListStoresInputSchema, SearchCatalogInputSchema, LookupCatalogInputSchema, GetProductInputSchema, ApiErrorCode`, and from `src/contracts/scan.ts` (DECISIONS §A): `ScanReport, AccessMethod`.

**DB helpers** (`@/lib/db`, 00 §6.10 + DECISIONS B12). Behavior per 01 §6.3:

| Helper | WS3 uses it for |
|---|---|
| `resolveStore(ref)`: uuid, slug, domain or URL. **Returns opted-out stores**, so callers must check `store.opted_out` | `catalog.store`, `?store=`, `/s/{slug}/*`, `/api/v1/stores/{slug}` |
| `getStoreBySlug(slug)` | `/s/{slug}/*` (then check `opted_out`) |
| `getProduct(ref)`: product uuid, variant uuid (returns the parent), `"{slug}:{seq}"`, or a numeric seq | `get_product`, `/api/v1/products/{id}` |
| `getProductByHandle(storeId, handle)` | `/s/{slug}/products/{handle}.json` |
| `getProductsByIds(ids)`: input order preserved | hydrating search results |
| `lookupProducts(refs)` → `{ products, not_found }` | `lookup_catalog` |
| `listStoreProducts(storeId, { limit, page })` → `{ products, total }`, ordered by seq | `products.json`, ACP feed, llms.txt sample |
| `searchProducts(SearchParams)` → `{ products: ProductSummary[], total_count, next_offset }` | `catalogSearch` |
| `listStores(opts)` → `StoreSummary[]` | `list_stores`, root llms.txt |
| `getLatestCrawlRun(storeId)` | `/api/v1/stores/{slug}` |
| `getIndexStats()` → `{ stores, products }` (B12) | root llms.txt |
| `getLatestScanForStore(storeId)` → `ScanReport \| null` (B12) | optional scan info (§6.5–6.6, §7.3) |
| `logAgentRequest({ surface, tool?, store_id?, user_agent? })` never throws | `logHit` |

**Shared helpers** (WS1, 00 §6.11):
- `src/shared/http.ts`: `route`, `json`, `text`, `errorResponse`, `preflight`, `parseSearchParams`, `CORS_HEADERS`, `getRequestId`.
- `src/shared/errors.ts`: `AppError`, `toAppError`.
- `src/shared/log.ts`: `log`.
- `src/shared/env.ts`: `appUrl()`, `optionalEnv`.
- `src/shared/money.ts`: `fromMinor` gives the Shopify `"25.00"` form; `acpPrice` gives `"25.00 USD"`; `formatMoney` is for display.

**WS2** (`@/lib/crawl`):
- `verifyOffer(variantId): Promise<Offer>` (`VerifyOfferFn`, 00 §6.7): a live re-check with an 8 s timeout that persists the new offer.
- `registerCrawlTools` from `@/lib/crawl/mcp-tools`.

WS1's T+30 stubs throw `AppError("not_implemented")` or register nothing, so WS3 can import both from day one.

**WS4:**
- `registerCheckoutTools` from `@/lib/checkout/mcp-tools`;
- `resolveCheckoutConnector(store)` from `@/lib/checkout/connectors`, the source of agent-checkout status (B10);
- WS1's T+30 stub exists for `mcp-tools`.

---

## 2. Conventions (apply to every route and tool)

1. **Base URL** = `appUrl()` from `src/shared/env.ts` (`APP_URL`, then `https://$VERCEL_PROJECT_PRODUCTION_URL`, then `http://localhost:3000`). Every absolute URL we emit (profiles, llms.txt, openapi, `_shoperzero` links) uses it. For a tunnel demo, set `APP_URL` to the tunnel URL.
2. **IDs** (00 §4.2): plain uuids for products and variants in MCP/REST. `products.json` uses numeric `seq`. Refs accepted by `get_product` / `lookup_catalog` are the forms `db.getProduct` understands. There are no `sz:` or `gid://` prefixes.
3. **Money:** integer minor units `{amount, currency}` everywhere. The exceptions are the Shopify-compat output (`fromMinor` → `"25.00"`) and the ACP feed (`acpPrice` → `"25.00 USD"`).
4. **Timestamps:** ISO 8601 UTC with milliseconds everywhere, including `products.json` (00 §4.3).
5. **Route handlers:**
   - Wrap every REST/file handler in WS1's `route(name, handler)`. It adds `Request-Id`, the error envelope and the timing log.
   - Every route file exports `OPTIONS = preflight`, except `/api/mcp`, which uses `mcpPreflight()` (§3.2).
   - Responses use WS1's `json()`/`text()`, which add the CORS headers from `CORS_HEADERS`.
   - Params are Promises: `const { slug } = await ctx.params`. Type `ctx` with the global `RouteContext<'/s/[slug]/products.json'>`, which `next dev`, `next build` and `next typegen` generate.
   - Keep the default Node runtime.
6. **Caching** (`src/features/catalog/http.ts`). Do not use `'use cache'`; Cache Components is off. Use `Cache-Control`, which Vercel's CDN honors:
   ```ts
   export const CACHE = {
     none:   "no-store",
     short:  "public, max-age=0, s-maxage=15, stale-while-revalidate=60",
     index:  "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
     static: "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
   } as const;
   /** Per-store outputs: never cache while a crawl is filling the index. */
   export const storeCache = (s: Pick<Store, "status">) => (s.status === "pending" || s.status === "crawling" ? CACHE.none : CACHE.index);
   ```
   CDN hits are not logged to `agent_requests`; that is acceptable.
7. **Errors** (B11, 00 §4.4):
   - REST uses `throw new AppError(code, message, details?)` inside `route()`. WS1 renders `{error:{code,message,details?,request_id}}` with 00's HTTP status table.
   - Codes WS3 uses: `bad_request` (bad cursor or query), `validation_error`, `not_found`, `forbidden` (opted-out store on JSON APIs), `rate_limited`, `upstream_error`, `upstream_timeout`, `not_implemented`, `internal`.
   - MCP tools use `toolError(err, tool)`, which produces the same envelope in `structuredContent` with `isError: true`.
   - Exception: the Shopify-compat routes (`/s/{slug}/products.json`, `/products/{handle}.json`) answer with Shopify's own bodies (`{"errors":"Not Found"}` 404, `{"errors":"Page * Limit exceeds the 25000 limit."}` 400). They mimic Shopify byte for byte, and clients of that format expect those bodies. Text routes (llms.txt) answer a plain `Not found` 404.
8. **Opted-out stores** (`store.opted_out`) are invisible to agents. They are 404 on per-store file routes, `forbidden` on `/api/v1/stores/{slug}`, and absent from search, lookups and `listStores` (the db helpers filter them). Their products are omitted from every output.
9. **Link header:**
   - Per-store responses add `Link: <{base}/s/{slug}/.well-known/ucp>; rel="ucp"; version="2026-08-25"`.
   - Root discovery responses add `Link: <{base}/.well-known/ucp>; rel="ucp"; version="2026-08-25"`.
   - This mirrors Shopify's live header. Helper: `ucpLinkHeader(url)`.
10. **`maxDuration`:** `/api/mcp` sets 300 (B8), because WS2's `index_store` and `scan_store` schedule work with `after()` inside it. No other WS3 route sets it.

---

## 3. MCP server

### 3.1 Packages (WS1 installs at T+0; WS3 installs nothing)

`mcp-handler@2.2.0`, `@modelcontextprotocol/server@2.1.0` and `zod@^4` (4.6.5 is current). The transport is **Streamable HTTP** on one URL, stateless, with no Redis and no SSE endpoint. `mcp-handler` 2 serves MCP spec 2026-07-28 natively and falls back to 2025-era streamable HTTP for older clients from the same handler (VERIFIED, §0).

### 3.2 Route: composition of the three registrars (`src/app/api/mcp/route.ts`)

```ts
import { createMcpHandler } from "mcp-handler";
import { registerCatalogTools } from "@/lib/mcp/tools/catalog";     // WS3
import { registerCrawlTools } from "@/lib/crawl/mcp-tools";         // WS2: index_store, get_crawl_status, scan_store, get_scan
import { registerCheckoutTools } from "@/lib/checkout/mcp-tools";   // WS4: 5 checkout tools + get_order
import { instrumentServer } from "@/lib/mcp/instrument";            // WS3: rate limit + agent_requests for every tool
import { MCP_INSTRUCTIONS } from "@/lib/mcp/instructions";
import { mcpPreflight, withCors } from "@/lib/agent/http";

export const maxDuration = 300; // B8: crawl/scan tools schedule work with after()

const handler = createMcpHandler(
  (server) => {
    instrumentServer(server);         // MUST run first: wraps every registerTool call below
    registerCatalogTools(server);
    registerCrawlTools(server);
    registerCheckoutTools(server);
  },
  {
    serverInfo: { name: "shoperzero", version: "0.1.0" },
    instructions: MCP_INSTRUCTIONS,
    verboseLogs: process.env.NODE_ENV !== "production",
  },
);

async function handle(req: Request): Promise<Response> {
  return withCors(await handler(req));
}
export { handle as GET, handle as POST, handle as DELETE };
export const OPTIONS = mcpPreflight;
```

`GET` and `DELETE` answer 405 from the stateless handler. That is correct, and clients handle it. The `(server)` parameter type is `McpServer` from `src/infrastructure/mcp/types.ts` (00 §6.9). If `mcp-handler`'s typings don't expose it that way, use `import type { McpServer } from "@modelcontextprotocol/server"` (VERIFIED to be what mcp-handler 2.2.0 passes).

`withCors` and `mcpPreflight` in `src/features/catalog/http.ts`. The MCP response is a stream, so WS3 re-wraps it rather than using WS1's `json()` (the pattern is VERIFIED in the sandbox):
```ts
export function withCors(res: Response): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) h.set(k, v);
  h.set("Access-Control-Expose-Headers", "Link, Request-Id, Mcp-Session-Id, MCP-Protocol-Version, Retry-After");
  if (!h.has("Cache-Control")) h.set("Cache-Control", "no-store");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
export function mcpPreflight(): Response {
  return new Response(null, { status: 204, headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Last-Event-ID, UCP-Agent, Request-Id",
    "Access-Control-Max-Age": "86400" } });
}
```

**Per-store MCP URL.** `{base}/api/mcp?store=<slug>` is the same server. Catalog tools read `?store=` from the request (`sdkCtx.http?.req?.url`) and use it when `catalog.store` is omitted. Per-store UCP profiles and llms.txt advertise this URL. The crawl and checkout tools ignore it.

### 3.3 One logging and rate-limit wrapper for all three registrars (`src/infrastructure/mcp/instrument.ts`)

`instrumentServer` replaces `registerTool` **on the server instance** (an own property, not a Proxy, so SDK internals keep their `this`). Every tool registered afterwards, from any registrar, is wrapped. The other registrars therefore must **not** log `agent_requests` themselves; otherwise each call is counted twice (CR-2).

```ts
import type { McpServer } from "./types";
import { toolError } from "./result";
import { AppError } from "@/lib/errors";
import { logHit } from "@/lib/agent/log";
import { rateLimit } from "@/lib/agent/ratelimit";

const EXPENSIVE = new Set(["index_store", "scan_store"]);   // start crawls / browser sessions

/** Best-effort store attribution from any registrar's structuredContent. */
function storeIdOf(sc: any): string | null {
  return sc?.store?.id ?? sc?.store_id ?? sc?.product?._shoperzero?.store?.id
      ?? sc?.products?.[0]?._shoperzero?.store?.id ?? null;
}

export function instrumentServer(server: McpServer): McpServer {
  const orig = server.registerTool.bind(server) as (...a: unknown[]) => unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).registerTool = (name: string, config: unknown, cb: (args: any, ctx: any) => Promise<any>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    orig(name, config, async (args: any, sdkCtx: any) => {
      const req: Request | null = sdkCtx?.http?.req ?? null;
      if (!rateLimit(req, EXPENSIVE.has(name) ? "expensive" : "read")) {
        return toolError(new AppError("rate_limited", "Too many requests from this client. Wait 60 seconds and retry."), name);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let result: any;
      try {
        result = await cb(args, sdkCtx);
        return result;
      } catch (err) {                        // registrars should never throw; this is the safety net
        result = toolError(err, name);
        return result;
      } finally {
        logHit("mcp", { tool: name, req, storeId: storeIdOf(result?.structuredContent),
                        agentProfile: args?.meta?.["ucp-agent"]?.profile ?? null });
      }
    });
  return server;
}
```

`tools/list` and `initialize` are not logged; only tool calls are. `sdkCtx.http.req` is VERIFIED to be the original request in mcp-handler 2.2.0. It may be undefined in fallback modes, and then logging loses only the user-agent.

### 3.4 Catalog registrar skeleton (`src/infrastructure/mcp/tools/catalog.ts`)

```ts
import type { ToolRegistrar } from "@/lib/mcp/types";
import { toolError, toolResult } from "@/lib/mcp/result";
import { GetProductInputSchema, ListStoresInputSchema, LookupCatalogInputSchema, SearchCatalogInputSchema } from "@/lib/contracts";
import { DESCRIPTIONS } from "./catalog-descriptions";   // §4 strings; optional split file

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const defaultStoreOf = (sdkCtx: any): string | null => {
  const url = sdkCtx?.http?.req?.url;
  return url ? new URL(url).searchParams.get("store") : null;
};

export const registerCatalogTools: ToolRegistrar = (server) => {
  server.registerTool("search_catalog", {
    title: "Search products", description: DESCRIPTIONS.search_catalog,
    inputSchema: SearchCatalogInputSchema, annotations: { readOnlyHint: true },
  }, async (args, sdkCtx) => {
    try {
      const body = await catalogSearch(args.catalog, { defaultStore: defaultStoreOf(sdkCtx) });
      return toolResult(body, searchSummary(body, args.catalog));
    } catch (err) { return toolError(err, "search_catalog"); }
  });
  // lookup_catalog, get_product, list_stores: same pattern (§4.2–§4.4)
};
```

Input schemas are 00 §6.8's exported schemas, passed as `inputSchema` unchanged. Do not declare `outputSchema` (00 §4.5).

### 3.5 `src/infrastructure/mcp/instructions.ts`

```ts
export const MCP_INSTRUCTIONS = `ShoperZero indexes online stores that are not on Shopify (WooCommerce, Magento, BigCommerce, Squarespace, Salesforce Commerce Cloud, custom) and exposes them with the same tool names as Shopify's UCP catalog MCP.
Flow: list_stores or search_catalog -> get_product (verify: true before quoting a final price) -> create_checkout -> update_checkout (address, shipping) -> complete_checkout.
Store not listed? scan_store checks how agents can reach it; index_store adds its catalog (poll get_scan / get_crawl_status).
Prices are integers in ISO 4217 minor units with a currency code: {"amount": 2500, "currency": "USD"} is $25.00. Put price limits in filters.price, not in the query.
If a checkout returns status "requires_escalation", give the buyer continue_url; it opens the merchant's own cart or product page.
Never call complete_checkout until the buyer has explicitly approved the exact total in this conversation.`;
```

### 3.6 Connecting clients

Local dev runs on `http://localhost:3000/api/mcp`; deployed, it is `https://<app>/api/mcp`.

- **Claude Code** (flag syntax VERIFIED with `claude mcp add --help`):
  ```bash
  claude mcp add --transport http shoperzero http://localhost:3000/api/mcp
  claude mcp add --transport http --scope user shoperzero https://<app>/api/mcp   # deployed, all projects
  claude mcp list        # expect: shoperzero ... Connected
  ```
  Inside Claude Code, `/mcp` shows the 14 tools.
- **Claude Desktop, remote connector** (public HTTPS URL only): Settings → Connectors → Add custom connector → name `ShoperZero`, URL `https://<app>/api/mcp`. The exact menu wording is UNVERIFIED. For a local server, expose it with `cloudflared tunnel --url http://localhost:3000` and set `APP_URL` to the tunnel URL.
- **Claude Desktop, local bridge** (stdio to HTTP; works with localhost). Edit `~/Library/Application Support/Claude/claude_desktop_config.json`, then restart the app:
  ```json
  { "mcpServers": { "shoperzero": { "command": "npx", "args": ["-y", "mcp-remote@0.14.3", "http://localhost:3000/api/mcp"] } } }
  ```
- **Cursor** (`.cursor/mcp.json`): `{ "mcpServers": { "shoperzero": { "url": "https://<app>/api/mcp" } } }`.
- **Vercel gotcha:** preview deployments have Deployment Protection on by default, so MCP clients get 401 or an HTML login page. Demo on the production domain, or disable protection for previews.

### 3.7 Fallbacks if `mcp-handler@2` misbehaves

Only `route.ts` and `instrument.ts` change; every registrar stays as it is.

- **Fallback A (no new package; VERIFIED standalone):** use the SDK's own handler.
  ```ts
  import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
  const sdk = createMcpHandler(() => {
    const server = new McpServer({ name: "shoperzero", version: "0.1.0" }, { instructions: MCP_INSTRUCTIONS });
    instrumentServer(server); registerCatalogTools(server); registerCrawlTools(server); registerCheckoutTools(server);
    return server;
  });
  async function handle(req: Request) { return withCors(await sdk.fetch(req)); }
  ```
- **Fallback B (SDK v1):** WS1 installs `mcp-handler@1.1.0 @modelcontextprotocol/sdk@1.26.0`.
  - Move the route to `src/app/api/[transport]/route.ts`; the endpoint stays `/api/mcp`.
  - Call `createMcpHandler(init, { instructions }, { basePath: "/api", maxDuration: 300 })`.
  - In `instrumentServer`, pass `config.inputSchema.shape` to the original `registerTool` (v1 takes a raw zod shape). This covers all three registrars at once.
  - Read the request from `extra.requestInfo` (UNVERIFIED; fall back to `null`).
  - Smoke-test `/api/v1/search` afterwards to confirm the dynamic `[transport]` segment does not shadow `/api/v1/*`.

---

## 4. Tool catalog (14 tools)

| Tools | Registrar (owner) | Spec |
|---|---|---|
| `search_catalog`, `lookup_catalog`, `get_product`, `list_stores` | `registerCatalogTools` (WS3) | §4.1–§4.4 |
| `index_store`, `get_crawl_status`, `scan_store`, `get_scan` | `registerCrawlTools` (WS2) | §4.5, spec 02 |
| `create_checkout`, `update_checkout`, `get_checkout`, `complete_checkout`, `cancel_checkout`, `get_order` | `registerCheckoutTools` (WS4) | §4.6, spec 04 |

Catalog outputs (B7): `structuredContent` equals the REST twin's JSON body, and product-bearing bodies use the UCP product shape (§6.4). Search and product bodies start with a `ucp` envelope that mirrors Shopify's live responses:

```ts
// src/features/catalog/formats/ucp.ts
export function ucpEnvelope(capabilities: string[]) {
  return {
    version: UCP_VERSION, status: "success",
    capabilities: Object.fromEntries(capabilities.map((c) => [c, [{ version: UCP_VERSION }]])),
  };
}
```

Every catalog description ends with this sentence (Shopify uses the same wording): `Prices are integers in the currency's ISO 4217 minor units, paired with a currency code: {"amount": 2500, "currency": "USD"} is $25.00. Convert to major units before quoting a price (divide by 100 for USD, EUR and GBP; JPY is already in whole units).`

### 4.1 `search_catalog`

**Input:** `SearchCatalogInputSchema` (00 §6.8). **Annotations:** `{ readOnlyHint: true }`. **REST twin:** `GET /api/v1/search`.

**Description (verbatim, plus the prices sentence):**
```
Search products across every store indexed by ShoperZero: WooCommerce, Magento, BigCommerce, Squarespace, Salesforce Commerce Cloud and custom stores that are not on Shopify. Use this for any shopping or product-discovery request.
The query takes keywords only (e.g. "black hoodie"). Put price limits in filters.price (minor units: $50 = 5000), not in the query. With no query and no filters, it browses recently updated products. Set catalog.store to a store slug or domain (from list_stores) to search a single store.
Results are paginated. Pass pagination.cursor from the previous response to get more.
Each product includes up to 10 variants (call get_product for all), the merchant's product URL, and its store in _shoperzero.store.
Index data can be hours old. Call get_product with verify: true before quoting a final price.
Response conforms to the UCP catalog search capability (dev.ucp.shopping.catalog.search).
```

**Behavior:** `catalogSearch()` (§5). Summary line: `Found {total_count} products{ in {store}} for "{query}"; showing {n}{, more available}.`

**Output example (`structuredContent` = REST body):**
```json
{
  "ucp": { "version": "2026-08-25", "status": "success",
           "capabilities": { "dev.ucp.shopping.catalog.search": [{ "version": "2026-08-25" }] } },
  "products": [{
    "id": "4f1c2a9e-7d1b-4c1e-9a52-3c8f0e6b2d11",
    "handle": "classic-pullover-hoodie",
    "title": "Classic Pullover Hoodie",
    "description": { "plain": "Heavyweight 400gsm cotton fleece hoodie with a kangaroo pocket and ribbed cuffs…" },
    "url": "https://demo-woo.example.com/product/classic-pullover-hoodie/",
    "categories": [{ "value": "Hoodies", "taxonomy": "merchant" }],
    "price_range": { "min": { "amount": 4500, "currency": "USD" }, "max": { "amount": 4500, "currency": "USD" } },
    "list_price_range": { "min": { "amount": 6000, "currency": "USD" }, "max": { "amount": 6000, "currency": "USD" } },
    "media": [{ "type": "image", "url": "https://demo-woo.example.com/wp-content/uploads/hoodie.jpg", "alt": "Classic Pullover Hoodie" }],
    "options": [{ "name": "Size", "values": [{ "label": "S" }, { "label": "M" }, { "label": "L" }] }],
    "variants": [{
      "id": "9b0d6c3e-1a2b-4c5d-8e9f-0a1b2c3d4e5f", "sku": "HOOD-CLS-M", "title": "M",
      "price": { "amount": 4500, "currency": "USD" }, "list_price": { "amount": 6000, "currency": "USD" },
      "availability": { "available": true }, "options": [{ "name": "Size", "label": "M" }], "media": [],
      "url": "https://demo-woo.example.com/product/classic-pullover-hoodie/?attribute_pa_size=m",
      "checkout_url": "https://demo-woo.example.com/?add-to-cart=128&quantity=1&utm_source=shoperzero&utm_medium=agent",
      "_shoperzero": { "seq": 3102, "checked_at": "2026-09-26T10:41:07.000Z", "inventory_quantity": 14 }
    }],
    "tags": ["hoodie", "fleece"],
    "_shoperzero": {
      "store": { "id": "0c7c…", "slug": "demo-woo-example-com", "name": "ShoperZero Demo Woo", "domain": "demo-woo.example.com", "platform": "woocommerce" },
      "brand": "Northline", "available": true, "checkout_methods": ["woo_store_api"],
      "variants_count": 3, "source": "platform_api", "seq": 1204, "score": 1.83, "updated_at": "2026-09-26T10:41:07.000Z",
      "products_json_url": "https://<app>/s/demo-woo-example-com/products/classic-pullover-hoodie.json"
    }
  }],
  "pagination": { "cursor": "eyJvIjoxMH0", "has_next_page": true, "total_count": 23 },
  "messages": []
}
```

**Errors:**
- Unknown store → `not_found` ("No indexed store matches 'x'. Call list_stores."). An opted-out store also returns `not_found`, so it is not revealed.
- Bad cursor → `bad_request`.
- `price.min > price.max` → `validation_error`.
- Zero results with a query is **not** an error: return success with the message `{type:"info", code:"no_results", content:"No matches. Try fewer keywords, remove filters, or ask to scan/index a store that is missing."}`.

### 4.2 `lookup_catalog`

**Input:** `LookupCatalogInputSchema` (≤ 10 refs). **Annotations:** `{ readOnlyHint: true }`. There is no REST twin (00 §6.8).

**Description:**
```
Look up several products or variants by identifier in one call (maximum 10 ids).
Accepts product ids and variant ids returned by search_catalog or get_product, or "{store_slug}:{product_seq}" ids from a store's products.json.
A variant id returns its parent product containing only the matched variant(s), each tagged inputs: [{id, match: "exact"}]. A product id returns the product with its featured variant tagged match: "featured". Results are grouped by product. Ids that match nothing are listed in not_found.
```

**Behavior:**
1. Call `lookupProducts(refs)`.
2. For each product and each ref that resolved to it: if the ref equals one of `product.variants[].id`, keep only the matched variants and tag them `inputs:[{id, match:"exact"}]`. Otherwise tag the first available variant (or the first variant) `match:"featured"` and keep all variants, capped at 25.
3. Map each product with `toUcpProduct(p, "full")`.

**Output:**
```json
{
  "ucp": { "version": "2026-08-25", "status": "success", "capabilities": { "dev.ucp.shopping.catalog.lookup": [{ "version": "2026-08-25" }] } },
  "products": [{ "id": "4f1c…", "title": "Classic Pullover Hoodie", "…": "…",
    "variants": [{ "id": "9b0d…", "title": "M", "price": { "amount": 4500, "currency": "USD" },
                   "availability": { "available": true }, "inputs": [{ "id": "9b0d…", "match": "exact" }] }] }],
  "not_found": ["demo-woo-example-com:999999"],
  "messages": [{ "type": "info", "code": "not_found", "content": "demo-woo-example-com:999999" }]
}
```
`not_found` follows 00; the matching `messages` entries mirror Shopify's live behavior. Partial misses are not errors.

### 4.3 `get_product`

**Input:** `GetProductInputSchema` (`catalog.id`, `catalog.verify?`). **Annotations:** `{ readOnlyHint: true, openWorldHint: true }`. **REST twin:** `GET /api/v1/products/{id}`.

WS3 additionally reads the optional `catalog.selected` (`[{name,label}]`, max 3), which Shopify's live tool also accepts. It needs a one-field addition to the schema (CR-1). Until that lands, ignore it; `z.object` strips unknown keys.

**Description:**
```
Get complete detail for one product: full description, every option and variant with price, list price, availability, SKU/GTIN and image, the merchant URL, and which checkout methods the store supports.
Accepts a product id or variant id from search_catalog or lookup_catalog, or a "{store_slug}:{product_seq}" id. A variant id selects that variant.
Set verify: true to re-check the live price and stock on the merchant's site before quoting a price or starting checkout. It is slower (up to about 8 s) and falls back to indexed data with a warning if the store cannot be reached.
```

**Behavior:**
1. `getProduct(ref)`. `null` → `not_found` ("No product with id 'x'. Ids come from search_catalog results.").
2. If the ref is one of the product's variant ids, treat that variant's options as `selected` (unless `selected` was given).
3. With `selected`, keep only variants whose options match every pair (case-insensitive); if none match, keep all and add the warning `no_matching_variant`. Compute `options[].values[]` as `{label, exists, available}`: `exists` = some variant matches `selected` with this option set to this value; `available` = one of those variants is available. Echo `selected` on the product.
4. Map with `toUcpProduct(p, "full")` (all variants, capped at 100).
5. `verify: true` → `verifyVariants(product, variantIds)` from `src/features/catalog/verify.ts`:
   - Call `verifyOffer(id)` for up to 5 of the remaining variants (available ones first), in parallel, with an 8 s overall `Promise.race`.
   - On success: compare with the indexed offer, overwrite the variant's `price`, `list_price`, `availability` and `_shoperzero.checked_at`, and set `_shoperzero.verified: true`. If the price changed, add `{type:"info", code:"price_changed", content:"M: was 45.00 USD, now 42.00 USD"}`. If availability changed, add `availability_changed`.
   - `AppError` `not_implemented` (WS2 not landed) adds the warning `verify_unavailable`.
   - `not_found` (the variant is gone at the source) marks the variant unavailable and adds the warning `no_longer_sold`.
   - Any other error, or the timeout, adds `{type:"warning", code:"verify_failed", content:"Could not reach the merchant; showing indexed data from <checked_at>."}`.
   - Recompute `price_range` from the returned variants.
   - Always add the 00 `verification` object: `{ verified_at, ok, changed_variant_ids, errors }`.

**Output:**
```json
{
  "ucp": { "version": "2026-08-25", "status": "success", "capabilities": { "dev.ucp.shopping.catalog.lookup": [{ "version": "2026-08-25" }] } },
  "product": {
    "id": "4f1c…", "handle": "classic-pullover-hoodie", "title": "Classic Pullover Hoodie",
    "description": { "plain": "Heavyweight 400gsm cotton fleece hoodie…", "html": "<p>Heavyweight 400gsm cotton fleece hoodie…</p>" },
    "url": "https://demo-woo.example.com/product/classic-pullover-hoodie/",
    "price_range": { "min": { "amount": 4200, "currency": "USD" }, "max": { "amount": 4200, "currency": "USD" } },
    "options": [{ "name": "Size", "values": [
      { "label": "S", "exists": true, "available": false },
      { "label": "M", "exists": true, "available": true },
      { "label": "L", "exists": true, "available": true } ] }],
    "selected": [{ "name": "Size", "label": "M" }],
    "variants": [{ "id": "9b0d…", "sku": "HOOD-CLS-M", "title": "M",
      "price": { "amount": 4200, "currency": "USD" }, "availability": { "available": true },
      "options": [{ "name": "Size", "label": "M" }], "barcodes": [{ "type": "gtin", "value": "0012345678905" }],
      "url": "https://…?attribute_pa_size=m", "checkout_url": "https://demo-woo.example.com/?add-to-cart=128&quantity=1&utm_source=shoperzero&utm_medium=agent",
      "_shoperzero": { "seq": 3102, "checked_at": "2026-09-26T11:02:13.000Z", "verified": true, "inventory_quantity": 14 } }],
    "_shoperzero": { "store": { "slug": "demo-woo-example-com", "platform": "woocommerce", "…": "…" }, "brand": "Northline",
                     "checkout_methods": ["woo_store_api"], "available": true, "updated_at": "…" }
  },
  "verification": { "verified_at": "2026-09-26T11:02:13.000Z", "ok": true, "changed_variant_ids": ["9b0d…"], "errors": [] },
  "messages": [{ "type": "info", "code": "price_changed", "content": "M: was 45.00 USD, now 42.00 USD" }]
}
```

### 4.4 `list_stores`

**Input:** `ListStoresInputSchema`. **Annotations:** `{ readOnlyHint: true }`. **REST twin:** `GET /api/v1/stores`, which is **WS2's file** (B1). The body is the same.

**Description:**
```
List the stores ShoperZero has indexed, with platform, product count, currency, crawl status, readiness grades (grade_before = the store on its own, grade_after = through ShoperZero), and checkout method (checkout_connector "woo_store_api" = headless agent checkout; "handoff" = the buyer finishes on the merchant's site). Each store has links to its products.json, llms.txt, product feed and UCP profile in urls.
Use it to see which stores exist, to pick a store slug for search_catalog, or to answer "which stores can you buy from?". If the store the buyer wants is missing, use scan_store / index_store.
```

**Behavior:** `listStores({ query, platform, has_checkout, limit })` → `toolResult({ stores }, "N stores")`. The body is exactly `{ stores: StoreSummary[] }` (00 §6.8), with no envelope and no extra keys, so it matches WS2's REST body. Scan data (`best_method`) appears only if 00's `Store`/`StoreSummary` carries the DECISIONS §A `best_method` column; WS3 adds nothing here.

### 4.5 Crawl and scan tools (owned by WS2; reference only)

Registered by `registerCrawlTools(server)` in `src/features/crawl/mcp-tools.ts`. Schemas, descriptions and behavior live in spec 02. WS3's round-1 `index_store`/`get_crawl_status` definitions moved there verbatim (B4).

| Tool | Input | Output | REST twin |
|---|---|---|---|
| `index_store` | `{ url, meta? }` | `{ store: Store, crawl_run_id }` | `POST /api/v1/stores` |
| `get_crawl_status` | `{ crawl_run_id, meta? }` | `CrawlRun` | `GET /api/v1/crawl-runs/{id}` |
| `scan_store` | `{ url, meta? }` | `{ scan_id, status_url }` | `POST /api/v1/scans` |
| `get_scan` | `{ scan_id, meta? }` | `ScanReport` | `GET /api/v1/scans/{id}` |

WS3's only obligations:
- compose `registerCrawlTools` in the route (§3.2);
- instrument it (logging and rate limit; `index_store` and `scan_store` use the `expensive` bucket);
- keep `maxDuration = 300`;
- mention scan/index in `MCP_INSTRUCTIONS` and llms.txt.

### 4.6 Checkout tools (owned by WS4; reference only)

Registered by `registerCheckoutTools(server)` in `src/features/checkout/mcp-tools.ts`, with schemas and descriptions from spec 04 §12 and 00 §6.8. Tools: `create_checkout`, `update_checkout`, `get_checkout`, `complete_checkout`, `cancel_checkout` and `get_order`. Each returns a `CheckoutSession` (`get_order` returns an `Order`). Errors use `toolError`. Every session carries the `timeline_url` message.

WS3 must not register any of these names; a duplicate name throws at startup. Before WS4's service lands, WS1's T+30 stub registers nothing, or WS4's day-one file returns handoff sessions (CR-2b).

### 4.7 When checkout is advertised (`src/features/catalog/checkout-status.ts`)

This is the single switch read by the profiles, llms.txt and openapi:

```ts
import type { PaymentRailId, Store } from "@/lib/contracts";
import { resolveCheckoutConnector } from "@/lib/checkout/connectors";   // B10

/** WS3 flips this to true once WS4's MCP checkout milestone (04 M6) passes end to end. */
export const CHECKOUT_TOOLS_LIVE = false;

/** Same env rules as WS4's paymentHandlers(): Stripe only when a test key is configured. */
export function enabledRails(): PaymentRailId[] {
  const r: PaymentRailId[] = [];
  if (process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) r.push("stripe_spt");
  return r;
}

export const agentCheckoutFor = (s: Pick<Store, "domain" | "platform">) =>
  CHECKOUT_TOOLS_LIVE && resolveCheckoutConnector(s) !== "handoff";
```
If `resolveCheckoutConnector` is not exported yet when WS3 builds this, temporarily use `s.checkout_connector !== "handoff"` and switch once WS4 exports it.

### 4.8 Optional scan info (`src/features/catalog/scan-info.ts`)

```ts
export interface ScanInfo { grade: ReadinessGrade; best_method: AccessMethod | "none"; report_url: string; scanned_at: string }
/** Latest scan for a store, or null. Never throws (discovery files must not fail because of scans). */
export async function scanInfo(store: Store): Promise<ScanInfo | null> {
  try {
    const s = await getLatestScanForStore(store.id);
    if (!s || s.status !== "done") return null;
    return { grade: s.grade, best_method: s.best_method, report_url: `${appUrl()}/scan/${s.id}`, scanned_at: s.updated_at };
  } catch { return null; }
}
```
Only per-store surfaces call it: one query per request. The root llms.txt uses `store.readiness.before?.grade`, which B2 derives from the latest scan, and `store.best_method` when present, so it adds no extra queries.

---

## 5. Search (`catalogSearch` in `src/features/catalog/search.ts`)

1. **Store:**
   - `ref = catalog.store ?? defaultStore`.
   - If set, `store = await resolveStore(ref)`. `null` or `store.opted_out` → `AppError("not_found", "No indexed store matches '<ref>'. Call list_stores.")`.
2. **Limit and cursor:**
   - `limit = clamp(pagination.limit ?? SEARCH_DEFAULT_LIMIT, 1, SEARCH_MAX_LIMIT)`.
   - `offset = decodeCursor(pagination.cursor)`. The cursor is base64url `{"o":<offset>}` (00 §4.4), capped at 1000. Invalid → `AppError("bad_request", "Invalid cursor; repeat the search without it.")`.
3. **Price filter:** `min > max` → `AppError("validation_error", ...)`.
4. **Query** (00 §6.8 mapping):
   ```ts
   const result = await searchProducts({
     query: catalog.query ?? null, store_id: store?.id ?? null,
     min_minor: f?.price?.min ?? null, max_minor: f?.price?.max ?? null,
     available: f?.available ?? true, brands: f?.brands ?? null, categories: f?.categories ?? null,
     currency: f?.price && catalog.context?.currency ? catalog.context.currency : null,
     limit, offset,
   });
   ```
5. **Hydrate:** the search body carries variants (UCP shape, B7), so call `full = await getProductsByIds(result.products.map((p) => p.id))`. It preserves order; copy `score` from the summaries. Map with `toUcpProduct(p, "summary")`, with variants capped at 10, available ones first.
6. **Pagination:** `{ cursor: result.next_offset != null ? encodeCursor(result.next_offset) : null, has_next_page: result.next_offset != null, total_count: result.total_count }`.
7. **Messages:** add `no_results` (info) when a query returned nothing.

REST `/api/v1/search` builds the same input from query params and returns the same body.

**Ranking and filters** are defined in 01 §4's `search_products` RPC; do not re-implement them in JS:
- the score is FTS all-terms plus any-term rank plus `word_similarity` on the title;
- ties go to recency;
- with no query, results are recency-ordered;
- price filters are range overlaps (`price_max ≥ min`, `price_min ≤ max`) in each product's own currency, and `currency` narrows them when `context.currency` is given;
- `categories` matches category or product_type;
- opted-out stores are excluded.

Stretch: hybrid pgvector + RRF behind the same signature (01 §13).

---

## 6. Output formats

Serializers are pure functions from `IndexedProduct` / `Store` (no DB access) in `src/features/catalog/formats/*`. Shared helpers in `src/features/catalog/formats/text.ts`:

```ts
export const stripHtml = (h: string) => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/p>/gi, "\n")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, " ").replace(/\n\s*/g, "\n").trim();
export const truncate = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…");
export const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const plainDescription = (p: IndexedProduct) => p.description_text ?? (p.description_html ? stripHtml(p.description_html) : "");
export const isAvailable = (v: IndexedVariant) => v.offer.availability === "in_stock" || v.offer.availability === "preorder";
```
Money strings come from WS1's `src/shared/money.ts`: `fromMinor` gives the Shopify `"25.00"` form, `acpPrice` gives `"25.00 USD"`, and `formatMoney` is for display in llms.txt. Timestamps are emitted as stored (ISO with milliseconds, 00 §4.3). `{base}` below is `appUrl()`.

### 6.1 `GET /s/{slug}/products.json` (Shopify-compatible list)

**Route** `src/app/s/[slug]/products.json/route.ts`:
1. `store = await getStoreBySlug(slug)`. `null` or `store.opted_out` → `404 {"errors":"Not Found"}`.
2. `parseShopifyPaging(url.searchParams)`:
   ```ts
   export function parseShopifyPaging(sp: URLSearchParams) {
     const l = Number.parseInt(sp.get("limit") ?? "", 10);
     const limit = Number.isFinite(l) && l >= 1 ? Math.min(l, 250) : 30;
     const p = Number.parseInt(sp.get("page") ?? "", 10);
     const page = Number.isFinite(p) && p >= 1 ? p : 1;
     if (page * limit > 25000) return { error: "Page * Limit exceeds the 25000 limit." } as const;
     return { limit, page } as const;
   }
   ```
   On `error` → `400 {"errors":"Page * Limit exceeds the 25000 limit."}`. These semantics match Shopify exactly (VERIFIED).
3. `const { products } = await listStoreProducts(store.id, { limit, page })`, ordered by `seq` asc (stable across pages while a crawl adds rows).
4. Body `{ "products": products.map(p => toShopifyListProduct(p, store)) }`. Stores that are pending or crawling return whatever exists (possibly `[]`).
5. Headers: WS1 `json()` (CORS, `Request-Id`), `Link` (per-store UCP), `Cache-Control: storeCache(store)`. `logHit("products_json", { tool: "list", storeId, req })`.

Accept but ignore `collection`, `since_id` and other unknown params. Stretch alias: `/s/{slug}/collections/all/products.json` → same handler.

**Field mapping, list product** (key order exactly as below; `_shoperzero` is last):

| Shopify key | Source | Notes |
|---|---|---|
| `id` | `p.seq` | number |
| `title` | `p.title` | |
| `handle` | `p.handle` | |
| `body_html` | `p.description_html ?? (p.description_text ? "<p>" + escapeHtml(text) + "</p>" : "")` | never null |
| `published_at` | `p.updated_at` | `IndexedProduct` has no `created_at` (00 §6.3); ISO string per 00 §4.3 |
| `created_at` | `p.updated_at` | |
| `updated_at` | `p.updated_at` | |
| `vendor` | `p.brand ?? store.name ?? store.domain` | never null |
| `product_type` | `p.product_type ?? ""` | |
| `tags` | `p.tags` | array (current Shopify list shape) |
| `variants` | `p.variants.map(toShopifyListVariant)` | sorted by `position` |
| `images` | see image table | |
| `options` | `p.options.length ? p.options.map((o,i)=>({ name:o.name, position:i+1, values:o.values })) : [{ name:"Title", position:1, values:["Default Title"] }]` | Shopify's no-option convention |
| `_shoperzero` | `{ uuid: p.id, store_domain, store_slug, platform, source_url: p.url, currency, brand: p.brand, gtin: first variant gtin, available: p.available, source: p.source, checkout_methods: p.checkout_methods, api_url: base + "/api/v1/products/" + p.id }` | namespaced extras; strict Shopify clients ignore unknown keys |

**List variant:**

| Key | Source | Notes |
|---|---|---|
| `id` | `v.seq` | |
| `title` | `v.title` | "M / Blue" or "Default Title" |
| `option1`, `option2`, `option3` | `v.options[p.options[i].name] ?? null`; with no options: `"Default Title"`, `null`, `null` | |
| `sku` | `v.sku` | null allowed |
| `requires_shipping` | `true` | assumption (physical goods) |
| `taxable` | `true` | assumption |
| `featured_image` | `v.image_url ? imageObj(v.image_url, [v.seq]) : null` | same shape as `images[]` |
| `available` | `isAvailable(v)` | |
| `price` | `fromMinor(v.offer.price)` | "25.00" |
| `grams` | `null` | unknown (Shopify sends an integer; null is honest) |
| `compare_at_price` | `v.offer.compare_at && v.offer.compare_at.amount > v.offer.price.amount ? fromMinor(v.offer.compare_at) : null` | |
| `position` | `v.position ?? index + 1` | |
| `product_id` | `p.seq` | |
| `created_at` | `p.updated_at` | |
| `updated_at` | `v.offer.checked_at` | |
| `_shoperzero` | `{ uuid: v.id, currency: v.offer.price.currency, gtin: v.gtin, url: v.offer.url ?? p.url, inventory_quantity: v.inventory_quantity }` | |

**Image object** (for `images[i]` and `featured_image`):

| Key | Source |
|---|---|
| `id` | `p.seq * 1000 + (i + 1)` (synthetic, stable while image order is stable) |
| `created_at`, `updated_at` | product times |
| `position` | `i + 1` |
| `product_id` | `p.seq` |
| `variant_ids` | seqs of variants whose `image_url === img.url` |
| `src` | `img.url` (hotlinked, never re-hosted) |
| `width`, `height` | `null` (unknown) |

Example (one product, trimmed):
```json
{ "products": [ {
  "id": 1204, "title": "Classic Pullover Hoodie", "handle": "classic-pullover-hoodie",
  "body_html": "<p>Heavyweight 400gsm cotton fleece hoodie…</p>",
  "published_at": "2026-09-26T10:40:55.000Z", "created_at": "2026-09-26T10:40:55.000Z", "updated_at": "2026-09-26T10:41:07.000Z",
  "vendor": "Northline", "product_type": "Hoodies", "tags": ["fleece", "hoodie"],
  "variants": [ { "id": 3102, "title": "M", "option1": "M", "option2": null, "option3": null, "sku": "HOOD-CLS-M",
      "requires_shipping": true, "taxable": true, "featured_image": null, "available": true, "price": "45.00",
      "grams": null, "compare_at_price": "60.00", "position": 2, "product_id": 1204,
      "created_at": "2026-09-26T10:40:55.000Z", "updated_at": "2026-09-26T10:41:07.000Z",
      "_shoperzero": { "uuid": "9b0d…", "currency": "USD", "gtin": null, "url": "https://…?attribute_pa_size=m", "inventory_quantity": 14 } } ],
  "images": [ { "id": 1204001, "created_at": "2026-09-26T10:40:55.000Z", "position": 1, "updated_at": "2026-09-26T10:40:55.000Z",
      "product_id": 1204, "variant_ids": [], "src": "https://demo-woo.example.com/wp-content/uploads/hoodie.jpg", "width": null, "height": null } ],
  "options": [ { "name": "Size", "position": 1, "values": ["S", "M", "L"] } ],
  "_shoperzero": { "uuid": "4f1c…", "store_domain": "demo-woo.example.com", "store_slug": "demo-woo-example-com", "platform": "woocommerce",
      "source_url": "https://demo-woo.example.com/product/classic-pullover-hoodie/", "currency": "USD", "brand": "Northline",
      "gtin": null, "available": true, "source": "platform_api", "checkout_methods": ["woo_store_api"],
      "api_url": "https://<app>/api/v1/products/4f1c…" }
} ] }
```

### 6.2 `GET /s/{slug}/products/{handle}.json` (Shopify-compatible single)

Route `src/app/s/[slug]/products/[handle]/route.ts`:
- `handle` param ends with `.json` → strip it and serve JSON. No suffix → `302` to the merchant's `product.url` (a human clicked it). `.js` suffix (Shopify AJAX shape) → 404 in MVP (stretch). Anything else → 404.
- `getStoreBySlug(slug)` (404 when missing or opted out), then `getProductByHandle(store.id, handle)`; missing → `404 {"errors":"Not Found"}`.
- Body `{ "product": toShopifyDetailProduct(p, store) }`. Same headers as §6.1. `logHit("products_json", { tool: "product", ... })`.

Detail key order (VERIFIED against allbirds): `id, title, body_html, vendor, product_type, created_at, handle, updated_at, published_at, template_suffix, published_scope, tags, variants, options, images, image, _shoperzero`. Differences from the list shape:

| Key | Value |
|---|---|
| `template_suffix` | `null` |
| `published_scope` | `"global"` |
| `tags` | `p.tags.join(", ")` (**string** in the detail shape) |
| `image` | `images[0]` object or `null` |
| `images[]` keys | `id, product_id, position, created_at, updated_at, alt, width, height, src, variant_ids` (`alt` = `img.alt ?? null`) |
| `_shoperzero` | list extras plus `available` (the detail shape has no variant `available`) |

Detail variant key order: `id, product_id, title, price, sku, position, inventory_policy ("deny"), compare_at_price, fulfillment_service ("manual"), inventory_management (null), option1, option2, option3, created_at, updated_at, taxable (true), barcode (v.gtin ?? null), grams (null), image_id (matching image id or null), weight (null), weight_unit ("kg"), inventory_quantity (v.inventory_quantity ?? 0), old_inventory_quantity (same), tax_code (null), requires_shipping (true), quantity_rule ({"min":1,"max":null,"increment":1}), price_currency (currency), compare_at_price_currency (currency if compare_at else ""), quantity_price_breaks ([]), _shoperzero ({uuid, available, url})`.

### 6.3 `GET /s/{slug}/feed.acp.jsonl` (ACP / OpenAI product feed)

One JSON object per line, one line per **variant**, `\n`-terminated, UTF-8. Page through `listStoreProducts(store.id, { limit: 250, page })` for `page = 1..ceil(total/250)`, capped at 10,000 rows. Build the body in memory (MVP catalogs are ≤ a few thousand rows). Headers: `Content-Type: text/plain; charset=utf-8` by default so the demo shows it in a browser; with `?download=1`, `Content-Type: application/x-ndjson` plus `Content-Disposition: attachment; filename="{slug}.acp.jsonl"`. Also `X-ACP-Feed-Version: 2026-04-17` (`ACP_VERSION`), CORS, and `Cache-Control: storeCache(store)`. `logHit("feed", ...)`. Unknown or opted-out slug → 404.

Omit keys whose value is unknown: never emit `null`, `""`, or `"null"`. Skip a row (and `console.warn` once per feed) if a required field cannot be filled (no `url`, or no image anywhere).

| ACP field | Req | Source |
|---|---|---|
| `item_id` | ✔ | `v.id` (variant uuid; stable) |
| `title` | ✔ | `truncate(p.variants.length > 1 ? `${p.title} - ${v.title}` : p.title, 150)` |
| `description` | ✔ | `truncate(plainDescription(p) \|\| p.title, 5000)` |
| `url` | ✔ | `v.offer.url ?? p.url` |
| `brand` | ✔ | `p.brand ?? store.name ?? store.domain` |
| `seller_name` | ✔ | `store.name ?? store.domain` |
| `image_url` | ✔ | `v.image_url ?? p.images[0]?.url` |
| `price` | ✔ | compare_at > price ? `acpPrice(compare_at)` : `acpPrice(price)` |
| `availability` | ✔ | `in_stock→in_stock`, `out_of_stock→out_of_stock`, `preorder→pre_order`, `unknown→unknown` |
| `sale_price` | | only when compare_at > price: `acpPrice(price)` |
| `group_id` | | `p.id` (only when `p.variants.length > 1`; must differ from `item_id`) |
| `listing_has_variations` | | `true` when `p.variants.length > 1` |
| `variant_dict` | | `v.options` when `p.variants.length > 1` and non-empty |
| `gtin` | | `v.gtin` only if `/^\d{8}$\|^\d{12,14}$/` |
| `mpn` | | omit (we do not have it) |
| `product_category` | | `p.category ?? p.product_type` (keep existing `>` separators) |
| `additional_image_urls` | | `p.images.slice(1, 10).map(i => i.url)` if non-empty |
| `color` | | value of the `v.options` key matching `/^colou?r$/i` |
| `size` | | value of the `v.options` key matching `/^size$/i` |
| `seller_url` | | `store.base_url` |
| `is_eligible_search` | | `true` |
| `is_eligible_checkout` | | `false` (checkout inside ChatGPT requires merchant approval; we do not claim it) |

Example line:
```json
{"item_id":"9b0d6c3e-1a2b-4c5d-8e9f-0a1b2c3d4e5f","title":"Classic Pullover Hoodie - M","description":"Heavyweight 400gsm cotton fleece hoodie with a kangaroo pocket.","url":"https://demo-woo.example.com/product/classic-pullover-hoodie/?attribute_pa_size=m","brand":"Northline","seller_name":"ShoperZero Demo Woo","image_url":"https://demo-woo.example.com/wp-content/uploads/hoodie.jpg","price":"60.00 USD","sale_price":"45.00 USD","availability":"in_stock","group_id":"4f1c2a9e-7d1b-4c1e-9a52-3c8f0e6b2d11","listing_has_variations":true,"variant_dict":{"Size":"M"},"product_category":"Hoodies","size":"M","seller_url":"https://demo-woo.example.com","is_eligible_search":true,"is_eligible_checkout":false}
```

### 6.4 UCP product shape (MCP and REST output)

`toUcpProduct(p, mode: "summary" | "full", opts?: { variantIds?: string[]; score?: number })` in `src/features/catalog/formats/ucp.ts`. The structure mirrors Shopify's live UCP MCP responses (§0). ShoperZero extras live under `_shoperzero`.

| UCP key | Source | summary mode | full mode |
|---|---|---|---|
| `id` | `p.id` | ✔ | ✔ |
| `handle` | `p.handle` | ✔ | ✔ |
| `title` | `p.title` | ✔ | ✔ |
| `description` | `{ plain }` / `{ plain, html }` | plain truncated to 280 chars | plain (≤5000) + html (`p.description_html` if present) |
| `url` | `p.url` | ✔ | ✔ |
| `categories` | `[p.category, p.product_type]` deduped, non-null → `{ value, taxonomy: "merchant" }` | ✔ | ✔ |
| `price_range` | `p.price_range` (recomputed from returned variants after verify) | ✔ | ✔ |
| `list_price_range` | min/max of `compare_at` where `compare_at > price`; omitted if none | ✔ | ✔ |
| `media` | `p.images.map(i => ({ type: "image", url: i.url, alt: i.alt ?? p.title }))` | first 3 | all (≤20) |
| `options` | `p.options.map(o => ({ name, values: o.values.map(label => ({ label })) }))`; with `selected`, values gain `exists` and `available` | ✔ | ✔ |
| `variants` | `toUcpVariant` | first 10, available first | all (≤100) or filtered |
| `tags` | `p.tags` | first 10 | all |
| `selected` | echo of input | – | when given |
| `_shoperzero` | `{ store: p.store (StoreRef), brand, available, checkout_methods, variants_count, source, seq, score? (search only), updated_at, products_json_url: base + "/s/{slug}/products/{handle}.json" }` | ✔ | ✔ |

`toUcpVariant(v, p, store)`:

| UCP key | Source |
|---|---|
| `id` | `v.id` |
| `sku` | `v.sku` (omit if null) |
| `barcodes` | `v.gtin ? [{ type: "gtin", value: v.gtin }] : omit` |
| `title` | `v.title` |
| `price` | `v.offer.price` |
| `list_price` | `v.offer.compare_at` when `> price`, else omit |
| `availability` | `{ available: isAvailable(v) }` |
| `options` | `Object.entries(v.options).map(([name, label]) => ({ name, label }))` |
| `media` | `v.image_url ? [{ type: "image", url: v.image_url }] : []` |
| `url` | `v.offer.url ?? p.url` |
| `checkout_url` | `cartPermalink(store, p, v, 1)` (Shopify puts a cart URL here; ours is the merchant add-to-cart or PDP link for human handoff) |
| `inputs` | lookup_catalog only |
| `_shoperzero` | `{ seq: v.seq, checked_at: v.offer.checked_at, inventory_quantity: v.inventory_quantity, verified?: true }` |

`cartPermalink(store, product, variant, qty)` in `src/features/catalog/formats/permalink.ts` (pure; WS4's handoff connector may import it):
```ts
const num = (s: string | null | undefined) => (s && /^\d+$/.test(s) ? s : null);
export function cartPermalink(store: { domain: string; platform: Platform }, p: { url: string; external_id: string | null },
                              v: { external_id: string | null; offer: { url: string | null } }, qty = 1): string {
  const origin = new URL(p.url).origin;   // product URLs are absolute on the merchant host (00 §6.3)
  const vid = num(v.external_id), pid = num(p.external_id);
  const utm = (u: string) => `${u}${u.includes("?") ? "&" : "?"}utm_source=shoperzero&utm_medium=agent`;
  switch (store.platform) {
    case "woocommerce": if (vid ?? pid) return utm(`${origin}/?add-to-cart=${vid ?? pid}&quantity=${qty}`); break;  // UNVERIFIED for variations on every Woo version; PDP fallback below
    case "bigcommerce": if (pid) return utm(`${origin}/cart.php?action=add&product_id=${pid}&qty=${qty}`); break;
    case "shopify":     if (vid) return utm(`${origin}/cart/${vid}:${qty}`); break;
  }
  return utm(v.offer.url ?? p.url);
}
```
This is the same table as WS4's handoff `continueUrl` (04 §8.2), so the link an agent sees in search results matches the checkout's `continue_url`. WS4 special-cases the demo store origin (`WOO_DEMO_URL`); WS3 does not need to.
Note: `Store.domain` is an identity key without `www.` and may carry a locale path (`bulk.com/uk`), so the origin comes from the product URL instead. Woo ids follow B9: `variant.external_id` is the Store API purchasable id, and `product.external_id` is the Woo product id.

### 6.5 llms.txt

Both routes: `Content-Type: text/plain; charset=utf-8` (renders in browsers; the llmstxt.org format is Markdown content), CORS, `Link` header, caching `CACHE.index` (root) or `storeCache(store)` (store). Log `llms_txt` with tool `root` / `store`. Render with template literals in `src/features/catalog/formats/llms.ts`. `{base}` = `appUrl()`. Omit a line entirely when its value is unknown. Unknown or opted-out slug → `404 Not found` (text).

**Root `/llms.txt` template (exact):**
```
# ShoperZero

> ShoperZero makes online stores that are not on Shopify readable and buyable by AI agents. It indexes WooCommerce, Magento, BigCommerce, Squarespace, Salesforce Commerce Cloud and custom stores, and serves each one through the interfaces Shopify stores expose: a Shopify-compatible products.json, a UCP profile, an MCP server with Shopify's UCP tool names, and an ACP product feed.

Index: {stats.stores} stores, {stats.products} products. Generated {nowIso}.

## For AI agents

- MCP endpoint (Streamable HTTP, no auth): `{base}/api/mcp`. Call `tools/list` for the tools and their schemas.
- UCP profile: `GET {base}/.well-known/ucp` (UCP version {UCP_VERSION}).
- REST API: `GET {base}/api/v1/search?q={query}` (OpenAPI at {base}/openapi.json).
- Every store also has its own llms.txt, products.json, product feed and UCP profile (links below).
- Store missing? `scan_store` checks how agents can reach it (API, page structure, or computer use) and grades it; `index_store` adds its catalog here.

### Typical agent flow

1. Find products: `search_catalog` (all stores, or one store via `catalog.store`). Use `list_stores` to see stores.
2. Confirm: `get_product` with `verify: true` re-checks the live price and stock on the merchant's site.
3. Buy: `create_checkout` with variant ids{checkoutFlowSuffix}
4. Pay: `complete_checkout`, only after the buyer approves the exact total.

### Rules

- Prices are integers in ISO 4217 minor units: {"amount": 2500, "currency": "USD"} is $25.00.
- Never complete a checkout without the buyer's explicit approval of the final total.
- If a checkout returns `requires_escalation`, send the buyer to `continue_url` on the merchant's site.
- Index data can be hours old; check `updated_at`, or use `verify: true`.
- Back off on HTTP 429.

## Stores

{for each store (status indexed, not opted out, product_count desc, max 200):}
- [{store.name ?? store.domain}]({base}/s/{slug}/llms.txt): {domain} · {platformLabel} · {product_count} products · {checkoutLabel}{scanSuffix}

## Docs

- [OpenAPI]({base}/openapi.json): REST read API for search, products and stores
- [UCP profile]({base}/.well-known/ucp): capabilities, services and payment handlers
- [Agent card]({base}/.well-known/agent-card.json): discovery card

## Optional

- [Universal Commerce Protocol](https://ucp.dev): the protocol our MCP tools follow
- [llms.txt](https://llmstxt.org): the format of this file
```
- `checkoutFlowSuffix`: if `CHECKOUT_TOOLS_LIVE` → `; stores with agent checkout return "ready_for_complete", others return "requires_escalation" with a merchant link.`; else `; checkout currently hands off to the merchant's site through continue_url.`
- `checkoutLabel`: `agent checkout` when `agentCheckoutFor(store)`, else `checkout via merchant site`.
- `scanSuffix` (optional): when `store.readiness.before?.grade` exists → ` · scan grade {grade}{store.best_method ? ` (best access: ${best_method})` : ""}`; else empty. It uses no extra queries (§4.8).
- `platformLabel`: `woocommerce→WooCommerce, magento→Magento, bigcommerce→BigCommerce, squarespace→Squarespace, sfcc→Salesforce Commerce Cloud, prestashop→PrestaShop, wix→Wix, shopify→Shopify, custom→Custom, unknown→Unknown platform`.

**Per-store `/s/{slug}/llms.txt` template (exact):**
```
# {store.name ?? store.domain}

> Agent-readable index of {store.base_url}, a {platformLabel} store, maintained by ShoperZero. {product_count} products{currency ? `, prices in ${currency}` : ""}. Last crawled {last_crawled_at ?? "not yet"}.

Source store: {store.base_url}
Index status: {status}{claimed ? " (verified by the merchant)" : ""}
Checkout: {storeCheckoutLine}

## For AI agents

- MCP endpoint scoped to this store (Streamable HTTP, no auth): `{base}/api/mcp?store={slug}`. Tools: `search_catalog`, `lookup_catalog`, `get_product`, `create_checkout`, `update_checkout`, `get_checkout`, `complete_checkout`, `cancel_checkout`, `get_order`.
- UCP profile: `GET {base}/s/{slug}/.well-known/ucp`
- REST search: `GET {base}/api/v1/search?store={slug}&q={query}`

### Typical agent flow

1. `search_catalog` with `catalog.store = "{slug}"` (automatic on the store-scoped MCP endpoint).
2. `get_product` with `verify: true` to confirm the live price and stock.
3. `create_checkout` with the chosen variant id and quantity.
4. `complete_checkout` only after the buyer explicitly approves the total.

Prices are integers in ISO 4217 minor units: {"amount": 2500, "currency": "USD"} is $25.00.

## Catalog data

- [products.json]({base}/s/{slug}/products.json): Shopify-compatible product list (`?limit=` up to 250, `?page=`)
- [Product JSON]({base}/s/{slug}/products/{firstHandle}.json): one product in Shopify's shape; replace the handle
- [ACP product feed]({base}/s/{slug}/feed.acp.jsonl): one JSON line per variant (OpenAI/ACP feed format)

## Products

{for the first 25 products by seq:}
- [{title}]({base}/s/{slug}/products/{handle}.json): {formatMoney(price_range.min)}{max > min ? `–${formatMoney(max)}` : ""} · {available ? "in stock" : "out of stock"}
{if product_count > 25:} - Full list: [{product_count} products]({base}/s/{slug}/products.json?limit=250)

## Optional

- [Merchant site]({store.base_url})
- [Store page]({store.urls.page}): human view on ShoperZero
- [All ShoperZero stores]({base}/llms.txt)
```
- `storeCheckoutLine`: live connector (`agentCheckoutFor(store)`) → `Agents can buy headlessly through ShoperZero. create_checkout returns "ready_for_complete"; pay with a Stripe test Shared Payment Token (see payment.handlers).` Otherwise → `Headless checkout is not available. create_checkout returns "requires_escalation" with continue_url, a prefilled cart or product page on the merchant's site where the buyer finishes.`
- If `status` is `failed` or `blocked`, add the line `Note: the last crawl did not complete ({status}); data may be partial.` after `Index status`.
- Optional scan line, only when `scanInfo(store)` returns data (§4.8), inserted after `Index status`: `Agent readiness scan: grade {grade} on its own (best access method: {best_method}); via ShoperZero: grade {store.readiness.after?.grade ?? "A"}. Report: {report_url}`. `best_method` is one of `api`, `dom`, `computer_use`, `none` (DECISIONS §A).

### 6.6 UCP profiles

`buildUcpProfile({ base, store?: Store, version = UCP_VERSION })` in `src/features/catalog/formats/ucp.ts`. Structure mirrors the live Shopify profile (VERIFIED): top-level `ucp` with `version`, `supported_versions`, `services["dev.ucp.shopping"][]`, `capabilities{}`, `payment_handlers{}`. No `signing_keys` (Shopify serves none either).

```ts
import { UCP_SUPPORTED_VERSIONS, UCP_VERSION } from "@/lib/contracts";   // ["2026-08-25", "2026-04-08"]
const OLDER_VERSIONS = UCP_SUPPORTED_VERSIONS.filter((v) => v !== UCP_VERSION);   // served at /.well-known/ucp/{version}
const spec = (v: string, path: string) => `https://ucp.dev/${v}/${path}`;
```

Capabilities we claim:
- Always: `dev.ucp.shopping.catalog.search`, `dev.ucp.shopping.catalog.lookup`.
- Only when `CHECKOUT_TOOLS_LIVE` **and** (root profile, or `agentCheckoutFor(store)`): `dev.ucp.shopping.checkout`, `dev.ucp.shopping.fulfillment` (extends checkout only; we have no cart), `dev.ucp.shopping.order`.
- Never: cart, discount, identity_linking (not implemented).

`payment_handlers`: `{}` unless checkout is claimed; then one entry per `enabledRails()` item.

**Root `/.well-known/ucp` example (checkout live):**
```json
{
  "ucp": {
    "version": "2026-08-25",
    "supported_versions": { "2026-04-08": "https://<app>/.well-known/ucp/2026-04-08" },
    "services": {
      "dev.ucp.shopping": [{
        "version": "2026-08-25",
        "spec": "https://ucp.dev/2026-08-25/specification/overview/",
        "transport": "mcp",
        "endpoint": "https://<app>/api/mcp",
        "schema": "https://ucp.dev/2026-08-25/services/shopping/mcp.openrpc.json"
      }]
    },
    "capabilities": {
      "dev.ucp.shopping.catalog.search": [{ "version": "2026-08-25", "spec": "https://ucp.dev/2026-08-25/specification/shopping/catalog/", "schema": "https://ucp.dev/2026-08-25/schemas/shopping/catalog_search.json" }],
      "dev.ucp.shopping.catalog.lookup": [{ "version": "2026-08-25", "spec": "https://ucp.dev/2026-08-25/specification/shopping/catalog/", "schema": "https://ucp.dev/2026-08-25/schemas/shopping/catalog_lookup.json" }],
      "dev.ucp.shopping.checkout": [{ "version": "2026-08-25", "spec": "https://ucp.dev/2026-08-25/specification/shopping/checkout/", "schema": "https://ucp.dev/2026-08-25/schemas/shopping/checkout.json" }],
      "dev.ucp.shopping.fulfillment": [{ "version": "2026-08-25", "spec": "https://ucp.dev/2026-08-25/specification/shopping/extensions/fulfillment/", "schema": "https://ucp.dev/2026-08-25/schemas/shopping/fulfillment.json", "extends": ["dev.ucp.shopping.checkout"] }],
      "dev.ucp.shopping.order": [{ "version": "2026-08-25", "spec": "https://ucp.dev/2026-08-25/specification/shopping/order/", "schema": "https://ucp.dev/2026-08-25/schemas/shopping/order.json" }]
    },
    "payment_handlers": {
      "app.shoperzero.stripe_spt": [{
        "id": "app.shoperzero.stripe_spt", "version": "2026-09-26", "spec": "https://<app>/llms.txt",
        "config": { "rail": "stripe_spt", "accepted": ["card"], "credential_type": "spt", "environment": "test" }
      }]
    }
  }
}
```
- `environment` is always `"test"`. Advertise the Stripe handler only when the configured key starts with `sk_test_`.
- Handler entry `id` equals the key and equals `PAYMENT_HANDLER_IDS[rail]`, so `PaymentInstrument.handler_id` matches both the profile and `CheckoutSession.payment.handlers[].id`.
- Without live checkout: `capabilities` has only the two catalog entries and `payment_handlers` is `{}` (required member, may be empty).

**Per-store `/s/{slug}/.well-known/ucp`:** same builder with `store`. Differences:
- `services[...][0].endpoint` = `https://<app>/api/mcp?store={slug}`;
- `supported_versions` = `{}` (not served per store);
- checkout capabilities follow the per-store rule;
- 404 (`AppError("not_found")`) for unknown or opted-out stores.
- Optional, only when `scanInfo(store)` returns data: a **sibling** key outside `ucp` (validators read `ucp`; Shopify's profile has no other top-level keys, and whether strict validators reject extra top-level keys is UNVERIFIED, so drop it if any agent complains):
  ```json
  "_shoperzero": { "scan": { "grade": "D", "best_method": "dom", "report_url": "https://<app>/scan/<scan_id>", "scanned_at": "2026-09-26T10:31:00.000Z" } }
  ```

**Versioned root `/.well-known/ucp/[version]`:** 404 unless `version ∈ OLDER_VERSIONS`. The root profile's `supported_versions` maps each `OLDER_VERSIONS` entry to `{base}/.well-known/ucp/{version}`. Otherwise the same profile built with `version` substituted into every `version` field and `ucp.dev/{version}/...` URL, and without `supported_versions`. (Our tool shapes are the same across these versions for the features we use; conformance is UNVERIFIED, risk #7 in the synthesis.)

Headers for all profile routes: `Content-Type: application/json; charset=utf-8`, CORS, `Cache-Control: CACHE.index` (per-store: `storeCache(store)`), and `Link` (self). `logHit("ucp", { tool: "root" | "store" })`.

### 6.7 `/.well-known/agent-card.json` (A2A discovery card)

A static-content card built per request (for `base`). We do **not** run an A2A server. The card is a discovery pointer, and its description says so. It uses A2A v1.0 fields (VERIFIED) plus v0.3 `url` / `preferredTransport` for older readers. Whether A2A clients tolerate an interface that is really MCP is UNVERIFIED; this is low priority (synthesis cut list #6).

```json
{
  "name": "ShoperZero",
  "description": "Product search and checkout across stores that are not on Shopify (WooCommerce, Magento, BigCommerce, Squarespace, custom). Speaks MCP with Shopify's UCP tool names at the interface URL below; it is not an A2A task server. See the UCP profile at /.well-known/ucp and /llms.txt.",
  "version": "0.1.0",
  "provider": { "organization": "ShoperZero", "url": "https://<app>" },
  "documentationUrl": "https://<app>/llms.txt",
  "supportedInterfaces": [{ "url": "https://<app>/api/mcp", "protocolBinding": "JSONRPC", "protocolVersion": "1.0" }],
  "url": "https://<app>/api/mcp",
  "preferredTransport": "JSONRPC",
  "protocolVersion": "0.3.0",
  "capabilities": { "streaming": false, "pushNotifications": false },
  "defaultInputModes": ["application/json", "text/plain"],
  "defaultOutputModes": ["application/json"],
  "skills": [
    { "id": "search_products", "name": "Search products", "description": "Search the cross-store catalog (MCP tool search_catalog).", "tags": ["shopping", "catalog", "ucp"], "examples": ["find a black hoodie under $50"] },
    { "id": "product_detail", "name": "Product detail", "description": "Variants, live price and stock (MCP tool get_product).", "tags": ["shopping", "catalog"] },
    { "id": "checkout", "name": "Checkout", "description": "Create and complete a checkout paid by Stripe test payments, or hand off to the merchant (MCP tools create_checkout, complete_checkout).", "tags": ["shopping", "checkout", "payments"] }
  ]
}
```
Headers: JSON, CORS, `CACHE.static`. `logHit("agent_card")` (00 `AgentSurface` includes it).

### 6.8 `/openapi.json`

`buildOpenApi(base)` in `src/features/catalog/formats/openapi.ts` returns an OpenAPI **3.1.0** object. `info: { title: "ShoperZero API", version: "0.1.0", description: "Read API for the ShoperZero cross-store product index. Prices are integer minor units." }`, `servers: [{ url: base }]`. Keep it under 30 operations (GPT Actions limit). Operations (`operationId` in parentheses):

- `GET /api/v1/search` (`searchProducts`): query params `q, store, min, max, available (true|false|any), brand (repeatable), limit, cursor`.
- `GET /api/v1/products/{id}` (`getProduct`): `verify, format (ucp|indexed), selected (repeatable "Name:Label")`.
- `GET /api/v1/stores` (`listStores`, WS2's route): `query, platform, has_checkout, limit` → `{ stores: StoreSummary[] }`.
- `GET /api/v1/stores/{slug}` (`getStore`).
- `POST /api/v1/stores` (`indexStore`, WS2): body `{ url }` or `{ store_id }` → 202 `{ store, crawl_run_id }`.
- `GET /api/v1/crawl-runs/{id}` (`getCrawlRun`, WS2) → `CrawlRun`.
- `POST /api/v1/scans` (`scanStore`, WS2): body `{ url, mode? }` → 202 `{ scan_id, store_id, status_url }`.
- `GET /api/v1/scans/{id}` (`getScan`, WS2) → `ScanReport`.
- `GET /s/{slug}/products.json` (`listStoreProductsShopify`): `limit, page`.
- Only when `CHECKOUT_TOOLS_LIVE`: `POST /api/v1/checkouts` (`createCheckout`), `GET /api/v1/checkouts/{id}` (`getCheckout`), `PUT /api/v1/checkouts/{id}` (`updateCheckout`), `POST /api/v1/checkouts/{id}/complete` (`completeCheckout`), `POST /api/v1/checkouts/{id}/cancel` (`cancelCheckout`), `GET /api/v1/orders/{id}` (`getOrder`). Request bodies reference the same shapes as the MCP args minus `meta`; responses reference `CheckoutSession`.

`components.schemas`: `Money {amount:integer, currency:string}`, `UcpVariant`, `UcpProduct`, `SearchResponse {ucp, products[], pagination{cursor, has_next_page, total_count}, messages[]}`, `StoreSummary`, `Store`, `CrawlRun`, `ScanReport` (summary level), `Error {error{code, message, details?, request_id?}}` (00 §4.4), `Message`, and when checkout is live, `CheckoutSession`. Hand-write these (about 150 lines); do not add a zod-to-openapi dependency. Headers: JSON, CORS, `CACHE.static`. `logHit("openapi")`.

### 6.9 `src/app/robots.ts`

```ts
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: "*",
      allow: "/",
      disallow: ["/api/v1/checkouts/", "/api/demo-wallet/", "/checkouts/"],
      other: { "Content-Signal": "search=yes, ai-input=yes, ai-train=no" },
    }],
  };
}
```
Expected output (VERIFIED format in sandbox):
```
User-Agent: *
Allow: /
Disallow: /api/v1/checkouts/
Disallow: /api/demo-wallet/
Disallow: /checkouts/
Content-Signal: search=yes, ai-input=yes, ai-train=no
```
No `Sitemap:` line (we have no sitemap). The file is prerendered at build, so do not read request data in it.

---

## 7. REST read API

All three routes are wrapped in WS1's `route()`. They respond via `json()` (CORS and `Request-Id`), export `OPTIONS = preflight`, and throw `AppError` for errors, which renders 00's envelope. The `UCP-Agent` header (`profile="…"`) is parsed and logged but never required. Query params are validated with `parseSearchParams(req, schema)`, which produces `validation_error` with `z.flattenError` details. Each route calls `rateLimit(req, "read")` → `AppError("rate_limited")` plus `Retry-After: 60`.

### 7.1 `GET /api/v1/search`

`src/app/api/v1/search/route.ts`. Params map onto the `search_catalog` input:

| Param | Maps to | Notes |
|---|---|---|
| `q` | `catalog.query` | keywords |
| `store` | `catalog.store` | slug, domain or uuid |
| `min`, `max` | `catalog.filters.price.min/max` | integer minor units (2500 = $25.00) |
| `available` | `catalog.filters.available` | `true` (default) \| `false` \| `any` (→ `null`) |
| `brand` | `catalog.filters.brands` | repeatable or comma-separated |
| `category` | `catalog.filters.categories` | repeatable or comma-separated |
| `currency` | `catalog.context.currency` | applied only with a price filter |
| `limit` | `catalog.pagination.limit` | 1–50, default 10 |
| `cursor` | `catalog.pagination.cursor` | from the previous response |

- Response 200: exactly the `search_catalog` `structuredContent` (§4.1; B7).
- Errors: 400 `bad_request` / `validation_error`, 404 `not_found` (store), 429 `rate_limited`.
- `Cache-Control: CACHE.short`. `logHit("rest", { tool: "search_catalog", storeId })`.

### 7.2 `GET /api/v1/products/{id}`

`src/app/api/v1/products/[id]/route.ts`. `id` is any ref `db.getProduct` accepts.

| Param | Meaning |
|---|---|
| `verify=1` | live re-check, as `get_product` with `verify: true` |
| `format=indexed` | return `{ "product": IndexedProduct, "verification"? }` unchanged (B7; for WS5 and internal use) |
| `selected=Size:M` | repeatable `Name:Label` pairs |

- Response 200 (default): the `get_product` body (§4.3).
- 404 `not_found`.
- `Cache-Control`: `verify` → `CACHE.none`, else `CACHE.short`.
- `logHit("rest", { tool: "get_product", storeId })`.

### 7.3 `GET /api/v1/stores/{slug}`

`src/app/api/v1/stores/[slug]/route.ts`. `slug` may also be a domain or uuid (`db.resolveStore`). `null` → 404 `not_found`; `opted_out` → 403 `forbidden` (00 §4.4).

The response body **is a `Store`** (WS5 reads it as `Store` in its polling fallback), with extra keys:
```json
{
  "...": "all Store fields (00 §6.4), including urls",
  "agent_checkout": false,
  "latest_crawl_run": { "id": "…", "status": "succeeded", "products_found": 42, "…": "CrawlRun" },
  "scan": { "grade": "D", "best_method": "dom", "report_url": "https://<app>/scan/…", "scanned_at": "…" }
}
```
- `agent_checkout` = `agentCheckoutFor(store)`.
- `latest_crawl_run` = `getLatestCrawlRun(store.id)` or `null`.
- `scan` = `scanInfo(store)` or `null` (optional, §4.8).
- `Cache-Control: CACHE.none` (the UI polls during crawls).
- Add the per-store `Link` header.
- `logHit("rest", { tool: "get_store", storeId })`.

`GET /api/v1/stores` (the list) is **WS2's** route (B1). It returns the same body as `list_stores`.

---

## 8. Request logging and rate limits

### 8.1 `logHit` (`src/features/catalog/log.ts`)

```ts
import { after } from "next/server";
import { logAgentRequest } from "@/lib/db";
import { log } from "@/lib/log";
import type { AgentSurface } from "@/lib/contracts";

export function logHit(surface: AgentSurface, o: { tool?: string; storeId?: string | null; req?: Request | null; agentProfile?: string | null } = {}) {
  const run = () => logAgentRequest({
    surface, tool: o.tool, store_id: o.storeId ?? null,
    user_agent: o.req?.headers.get("user-agent") ?? null,
  });
  if (o.agentProfile) log.info("agent.ucp_profile", { surface, tool: o.tool, profile: o.agentProfile });
  try { after(run); } catch { void run(); }   // after() throws outside a request scope
}
```
`logAgentRequest` never throws (01 §6.3). `after()` inside MCP tool callbacks is VERIFIED to run after the response.

What gets logged, one row each:

| Surface | When |
|---|---|
| `mcp` | Every tool call from all three registrars, via `instrumentServer` (§3.3). WS2 and WS4 registrars must not also log (CR-2). |
| `rest` | Search, product, one store. |
| `products_json` | `list`, `product`. |
| `feed` | ACP feed request. |
| `llms_txt` | `root`, `store`. |
| `ucp` | `root`, `store`, `version`. |
| `openapi`, `agent_card` | Those two files. |

`robots.txt` is not logged. Logging failures never affect the response.

### 8.2 Rate-limit stance (`src/features/catalog/ratelimit.ts`)

The index is public and read-only, so there is no auth. A best-effort, per-instance, in-memory token bucket protects against runaway agent loops and against repeated crawl or scan launches. It is **not** a security boundary, because serverless instances do not share memory.

```ts
const BUCKETS = { read: { cap: 120, perMs: 60_000 }, expensive: { cap: 5, perMs: 600_000 } } as const;
const state = new Map<string, { tokens: number; ts: number }>();
export function clientKey(req: Request | null) {
  return req?.headers.get("x-forwarded-for")?.split(",")[0].trim() || req?.headers.get("x-real-ip") || "anon";
}
export function rateLimit(req: Request | null, kind: keyof typeof BUCKETS): boolean {
  const { cap, perMs } = BUCKETS[kind]; const k = `${kind}:${clientKey(req)}`; const now = Date.now();
  const s = state.get(k) ?? { tokens: cap, ts: now };
  s.tokens = Math.min(cap, s.tokens + ((now - s.ts) / perMs) * cap); s.ts = now;
  if (s.tokens < 1) { state.set(k, s); return false; }
  s.tokens -= 1; state.set(k, s);
  if (state.size > 10_000) state.clear();
  return true;
}
```
- MCP: every tool call goes through `instrumentServer`; `index_store` and `scan_store` use the `expensive` bucket.
- REST read routes use `read`.
- Per-store files (products.json, feed, llms.txt, profiles) are not rate-limited; the CDN caches them.
- WS2 applies its own crawl and scan concurrency caps server-side.
- Upgrade path (stretch): Vercel WAF rate-limit rules or Upstash.

---

## 9. Build order, milestones and acceptance tests

Setup for all tests: `nvm use` (Node 22; Inspector v2 needs ≥ 22.19), then `npm run dev`, then:
```bash
export APP=http://localhost:3000
export SLUG=<slug of the seed store>          # psql: select slug from stores limit 1;
# MCP helper: POSTs JSON-RPC and prints the JSON payload (handles SSE framing and plain JSON)
mcp() { curl -sS -X POST "$APP/api/mcp" -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' -A 'sz-smoke/1.0' -d "$1" | sed -n -e 's/^data: //p' -e 't' -e '/^{/p' | jq "${2:-.}"; }
call() { mcp "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}" '.result'; }
```
WS3 builds against the WS1 seed (1 store, 3 products) until the crawler works.

### M1: MCP route alive with all three registrars composed (T+0:30 → T+1:15)
Build: `instrument.ts`, `instructions.ts`, `tools/catalog.ts` (`list_stores` first), the route, `src/features/catalog/{http,log,ratelimit}.ts`. The crawl and checkout registrars are WS1's T+30 stubs at this point.
```bash
mcp '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' '.result.tools | map(.name)'
# now: the 4 catalog tools (+ whatever WS2/WS4 have registered)
# final: 14 = search_catalog lookup_catalog get_product list_stores
#             index_store get_crawl_status scan_store get_scan
#             create_checkout update_checkout get_checkout complete_checkout cancel_checkout get_order
mcp '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' '.result.serverInfo, .result.instructions'
curl -s -o /dev/null -w "%{http_code}\n" -X POST $APP/api/mcp -H 'content-type: application/json' -d '{}'   # 406 (missing Accept)
curl -s -i -X OPTIONS $APP/api/mcp | grep -i access-control-allow-origin                                  # *
npx @modelcontextprotocol/inspector --cli --transport http --server-url $APP/api/mcp --method tools/list  # Inspector v2
# Node < 22.19: npx @modelcontextprotocol/inspector@v1-latest --cli $APP/api/mcp --transport http --method tools/list
claude mcp add --transport http shoperzero $APP/api/mcp && claude mcp list   # "shoperzero ... Connected"
```
If `tools/list` fails in a way that points at mcp-handler, switch to Fallback A (§3.7) within 15 minutes. **Duplicate-name check:** a startup error `Tool … already registered` means two registrars claim one name. Fix ownership per the §4 table.

### M2: `search_catalog`, `get_product`, `list_stores` and their REST twins (→ T+2:30)
```bash
call list_stores '{}' | jq '.structuredContent.stores[] | {slug, product_count, checkout_connector, grade_before, grade_after}'
call search_catalog '{"catalog":{"query":"hoodie","pagination":{"limit":2}}}' | jq '.structuredContent | {n: (.products|length), p: .pagination}'
call search_catalog '{"catalog":{"filters":{"price":{"max":5000}}}}' | jq '[.structuredContent.products[].price_range.min.amount] | all(. <= 5000)'   # true
call search_catalog '{"catalog":{"store":"nope-example-com","query":"x"}}' | jq '.isError, .structuredContent.error.code'   # true, "not_found"
C=$(call search_catalog '{"catalog":{"pagination":{"limit":1}}}' | jq -r '.structuredContent.pagination.cursor'); \
  call search_catalog "{\"catalog\":{\"pagination\":{\"limit\":1,\"cursor\":\"$C\"}}}" | jq '.structuredContent.products[0].id'   # differs from page 1
PID=$(call search_catalog '{"catalog":{}}' | jq -r '.structuredContent.products[0].id')
call get_product "{\"catalog\":{\"id\":\"$PID\"}}" | jq '.structuredContent.product | {title, variants: (.variants|length), store: ._shoperzero.store.slug}'
call get_product "{\"catalog\":{\"id\":\"$PID\",\"verify\":true}}" | jq '.structuredContent | {verification, messages}'   # verify_unavailable until WS2 lands
call get_product '{"catalog":{"id":"00000000-0000-0000-0000-000000000000"}}' | jq '.structuredContent.error.code'  # "not_found"
# structuredContent == REST body (B7):
diff <(call search_catalog '{"catalog":{"query":"hoodie","pagination":{"limit":2}}}' | jq -S '.structuredContent') \
     <(curl -s "$APP/api/v1/search?q=hoodie&limit=2" | jq -S .) && echo "TWIN OK"
curl -s "$APP/api/v1/products/$PID" | jq '.product.title'
curl -s "$APP/api/v1/products/$PID?format=indexed" | jq '.product | has("seq") and has("store")'        # true
curl -s "$APP/api/v1/stores/$SLUG" | jq '{slug, status, agent_checkout, crawl: .latest_crawl_run.status, scan}'
curl -s "$APP/api/v1/search?cursor=%%%" | jq '.error.code'                                               # "bad_request"
curl -s -i "$APP/api/v1/search?q=hoodie" | grep -i -E 'access-control-allow-origin|cache-control|request-id'
```
Claude smoke test: in Claude Code, ask "Using shoperzero, list the stores you can shop, then find me a hoodie under $50." Expect `list_stores` → `search_catalog` with `filters.price.max = 5000`, and prices quoted in dollars.

### M3: products.json byte-compatible with Shopify (→ T+3:15)
```bash
curl -s "$APP/s/$SLUG/products.json?limit=1" | jq '.products[0] | {id, price: .variants[0].price}'   # id number, price "45.00"
shape='.products[0] | del(._shoperzero) | {product: keys, variant: (.variants[0] | del(._shoperzero) | keys), image: (.images[0] | keys), option: (.options[0] | keys)}'
diff <(curl -s -A 'Mozilla/5.0' 'https://www.allbirds.com/products.json?limit=1' | jq -S "$shape") \
     <(curl -s "$APP/s/$SLUG/products.json?limit=1" | jq -S "$shape") && echo "LIST SHAPE OK"
H=$(curl -s -A 'Mozilla/5.0' 'https://www.allbirds.com/products.json?limit=1' | jq -r '.products[0].handle')
MYH=$(curl -s "$APP/s/$SLUG/products.json?limit=1" | jq -r '.products[0].handle')
dshape='.product | del(._shoperzero) | {product: keys, variant: (.variants[0] | del(._shoperzero) | keys), image: (.images[0] | keys)}'
diff <(curl -s -A 'Mozilla/5.0' "https://www.allbirds.com/products/$H.json" | jq -S "$dshape") \
     <(curl -s "$APP/s/$SLUG/products/$MYH.json" | jq -S "$dshape") && echo "DETAIL SHAPE OK"
curl -s "$APP/s/$SLUG/products.json?limit=0" | jq '.products|length'                       # min(30, count)
curl -s "$APP/s/$SLUG/products.json?limit=999" | jq '.products|length'                     # min(250, count)
curl -s "$APP/s/$SLUG/products.json?page=9999&limit=2" | jq -c .                           # {"products":[]}
curl -s -w " %{http_code}\n" "$APP/s/$SLUG/products.json?page=99999&limit=2"               # {"errors":"Page * Limit exceeds the 25000 limit."} 400
curl -s -w " %{http_code}\n" "$APP/s/does-not-exist/products.json"                         # {"errors":"Not Found"} 404
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "$APP/s/$SLUG/products/$MYH"      # 302 → merchant PDP
```
The store needs at least one image and one variant. Both `diff`s must print nothing.

### M4: llms.txt (→ T+3:45)
```bash
curl -s -i $APP/llms.txt | head -20             # 200, text/plain, "# ShoperZero", store list present
curl -s $APP/s/$SLUG/llms.txt                   # H1 = store name; MCP URL has ?store=$SLUG; product lines with prices
curl -s $APP/s/$SLUG/llms.txt | grep -i "readiness scan" || echo "(no scan yet: line omitted, OK)"
curl -s -o /dev/null -w "%{http_code}\n" $APP/s/does-not-exist/llms.txt   # 404
```
Paste the per-store file into Claude and ask "how do I buy from this store?" The answer should name the MCP URL and the search → verify → checkout flow.

### M5: UCP profiles (→ T+4:30)
```bash
curl -s $APP/.well-known/ucp | jq '.ucp | {version, services: (.services["dev.ucp.shopping"][0] | {transport, endpoint}), caps: (.capabilities|keys), handlers: (.payment_handlers|keys)}'
diff <(curl -s -A 'Mozilla/5.0' https://www.allbirds.com/.well-known/ucp | jq -S '.ucp | keys') <(curl -s $APP/.well-known/ucp | jq -S '.ucp | keys') && echo "UCP KEYS OK"
diff <(curl -s -A 'Mozilla/5.0' https://www.allbirds.com/.well-known/ucp | jq -S '.ucp.services["dev.ucp.shopping"][0] | keys') \
     <(curl -s $APP/.well-known/ucp | jq -S '.ucp.services["dev.ucp.shopping"][0] | keys') && echo "SERVICE KEYS OK"
curl -s $APP/s/$SLUG/.well-known/ucp | jq -r '.ucp.services["dev.ucp.shopping"][0].endpoint'   # .../api/mcp?store=$SLUG
curl -s $APP/s/$SLUG/.well-known/ucp | jq '._shoperzero.scan // "no scan (omitted)"'
curl -s -o /dev/null -w "%{http_code}\n" $APP/.well-known/ucp/2026-04-08                         # 200
curl -s -o /dev/null -w "%{http_code}\n" $APP/.well-known/ucp/1999-01-01                         # 404
curl -s -I $APP/.well-known/ucp | grep -i '^link:'                                               # rel="ucp"; version="2026-08-25"
```
Interop check (needs a public URL, so use the deployed app or a tunnel). Today Shopify's MCP accepted any fetchable UCP profile URL as the agent profile, which proves the profile is fetchable and parseable by a real UCP implementation. That acceptance is observed behavior, UNVERIFIED as a guarantee. If it fails, record the error and move on; it is not a blocker.
```bash
curl -s -X POST https://weareallbirds.myshopify.com/api/ucp/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_catalog","arguments":{"meta":{"ucp-agent":{"profile":"https://<app>/.well-known/ucp"}},"catalog":{"query":"wool runner","pagination":{"limit":1}}}}}' \
  | jq '.error // .result.structuredContent.ucp.status'      # "success"
```

### M6: logging wrapper covers all three registrars (after WS2/WS4 registrars land, → T+5:00)
```bash
mcp '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' '.result.tools | length'     # 14
call search_catalog '{"catalog":{"query":"x"}}' >/dev/null
call get_crawl_status '{"crawl_run_id":"00000000-0000-0000-0000-000000000000"}' >/dev/null   # WS2 tool (not_found is fine)
call get_order '{"id":"00000000-0000-0000-0000-000000000000"}' >/dev/null                   # WS4 tool (not_found is fine)
# SQL: select tool, count(*) from agent_requests where surface='mcp' and user_agent='sz-smoke/1.0' group by tool;
#   exactly 1 row each for search_catalog, get_crawl_status, get_order (2+ means a registrar logs on its own; CR-2)
for i in 1 2 3 4 5 6; do call scan_store '{"url":"https://example.com"}' | jq -r '.structuredContent.error.code // "ok"'; done   # 6th → rate_limited
```

### M7: ACP feed (→ T+5:30)
```bash
curl -s $APP/s/$SLUG/feed.acp.jsonl | head -2
curl -s $APP/s/$SLUG/feed.acp.jsonl | jq -s 'length'        # equals the store's variant count
curl -s $APP/s/$SLUG/feed.acp.jsonl | jq -e -s 'all(.[]; (.item_id and .title and .description and .url and .brand and .seller_name and .image_url and .availability) and (.price | test("^[0-9]+(\\.[0-9]+)? [A-Z]{3}$")))'   # true
curl -s $APP/s/$SLUG/feed.acp.jsonl | grep -c ':null' || true   # 0
curl -s -I "$APP/s/$SLUG/feed.acp.jsonl?download=1" | grep -i -E 'content-type|content-disposition'
```

### M8: openapi.json, agent card, robots (→ T+6:00)
```bash
curl -s $APP/openapi.json | jq '.openapi, (.paths|keys), ([.paths[][]|.operationId]|length)'   # "3.1.0", paths, ≤30
npx -y @redocly/cli@latest lint $APP/openapi.json      # optional; errors must be fixed
curl -s $APP/.well-known/agent-card.json | jq '.name, .supportedInterfaces[0].url, [.skills[].id]'
curl -s $APP/robots.txt                                 # contains "Content-Signal: search=yes, ai-input=yes, ai-train=no"
```

### M9: agent_requests coverage and REST rate limit (→ T+6:30)
```bash
for p in "s/$SLUG/products.json" "s/$SLUG/llms.txt" "llms.txt" ".well-known/ucp" "s/$SLUG/feed.acp.jsonl" "openapi.json" "api/v1/search?q=x"; do curl -s -o /dev/null "$APP/$p"; done
# SQL: select surface, tool, store_id is not null as has_store from agent_requests order by id desc limit 10;
#   rows for products_json, llms_txt (store+root), ucp, feed, openapi, rest
for i in $(seq 1 130); do curl -s -o /dev/null -w "%{http_code}\n" "$APP/api/v1/search?q=x"; done | sort | uniq -c   # some 429 after 120 (per instance)
```

### M10: end-to-end demo with WS2 scan/index and WS4 checkout (then flip `CHECKOUT_TOOLS_LIVE`)
```bash
VID=$(call get_product "{\"catalog\":{\"id\":\"$PID\"}}" | jq -r '.structuredContent.product.variants[0].id')
call create_checkout "{\"checkout\":{\"line_items\":[{\"variant_id\":\"$VID\",\"quantity\":1}],\"buyer\":{\"email\":\"ada@example.com\"},\"fulfillment\":{\"address\":{\"name\":\"Ada\",\"line1\":\"1 Market St\",\"city\":\"San Francisco\",\"region\":\"CA\",\"postal_code\":\"94105\",\"country\":\"US\"}}}}" \
  | jq '.structuredContent | {status, continue_url, handlers: [.payment.handlers[].id]}'
```
Once WS4's M6 passes, WS3 sets `CHECKOUT_TOOLS_LIVE = true` and re-runs M5: the root profile now lists checkout, fulfillment, order and the enabled payment handlers, and per-store profiles list them only where `agentCheckoutFor(store)` holds.

Claude Desktop demo prompts:
- "find me a hoodie under $50 across these stores and buy it". Expect `search_catalog` → `get_product` (verify) → `create_checkout` → a request for approval → `complete_checkout`.
- "Can agents shop at hester-demo.squarespace.com?". Expect `scan_store` → `get_scan` → `index_store` → `search_catalog`.

### Stretch (only after M1–M9 are green)
- `{slug}.shoperzero.app` subdomains via a `proxy.ts` rewrite. `proxy.ts` is WS1's file, so coordinate. Map `/.well-known/ucp`, `/products.json` and `/llms.txt` onto `/s/{slug}/…`.
- NLWeb-style `GET /s/{slug}/ask?query=` → schema.org `ItemList` of `Product` (reuses `catalogSearch`).
- `/s/{slug}/collections/all/products.json` alias; `/products/{handle}.js` (the Shopify AJAX shape, integer cents).
- `/.well-known/mcp/server-card.json` (draft SEP-2127; the path is unsettled).
- WS3 migration `20260926025000_ws3_agent_requests.sql` (B15 allows later-timestamped stream migrations): `alter table public.agent_requests add column agent_profile text;`, then log `agentProfile` into it.

---

## 10. Risks and UNVERIFIED items

| Item | Status | Fallback |
|---|---|---|
| mcp-handler v2 inside the real repo | VERIFIED in a sandbox with the same versions (`next@16.3.6`, `next dev` and `next build`) | Fallback A (SDK `createMcpHandler`), then B (v1) (§3.7) |
| `instrumentServer` patching `registerTool` on the instance | Standard JS own-property override; not run against WS2/WS4 code yet | If a registrar captured `server.registerTool` before instrumentation, call `instrumentServer` first (the route already does) |
| `McpServer` type derivation in `src/infrastructure/mcp/types.ts` (00 §6.9) | UNVERIFIED against mcp-handler typings | `import type { McpServer } from "@modelcontextprotocol/server"` |
| Claude Desktop custom connector menu wording | UNVERIFIED | `mcp-remote` bridge config (§3.6) |
| Inspector v2 CLI on Node 20 | Inspector needs Node ≥ 22.19 | `nvm use` (repo pins 22) or `@modelcontextprotocol/inspector@v1-latest` |
| Woo `?add-to-cart=<purchasable id>` for variations | UNVERIFIED on all Woo versions | PDP fallback in `cartPermalink`; WS4's handoff owns the real `continue_url` |
| UCP validators and extra top-level `_shoperzero` in per-store profiles | UNVERIFIED | Omit the key (it is optional) |
| UCP validators requiring `signing_keys` or handler `schema` URLs | UNVERIFIED (Shopify serves no `signing_keys`) | Omit; add if an agent rejects the profile |
| Serving `2026-04-08` with the same shapes | UNVERIFIED conformance | Drop `supported_versions` if a strict agent complains |
| A2A clients reading an MCP interface in the agent card | UNVERIFIED; low value | Cut (synthesis cut list #6) |
| CDN caching hides hits from `agent_requests` | Accepted | Lower `s-maxage` if the metrics strip looks too quiet |
| Vercel preview Deployment Protection blocks MCP clients | Known | Demo on the production domain |

---

## Contract change requests

Round-1 CRs that DECISIONS accepted or superseded are marked. Everything else is additive.

- **Accepted in round 2 (no action):**
  - old CR-1: the extra db helpers (B12);
  - old CR-6: `search_path` on `search_products` (already in 01 §4);
  - old CR-8: UCP product shape plus `?format=indexed` (B7);
  - `maxDuration = 300` (B8).
- **Withdrawn:**
  - old CR-2 (`IndexedProduct.created_at`): Shopify-compat uses `updated_at`;
  - old CR-3/CR-4 (WS2 imports and the shared `stores/route.ts`): superseded by B1 and B4;
  - old CR-9 (proxy matcher): already in 01 §8;
  - old CR-5 (checkout registrar shape): superseded by B4 and 00 §3.3. Parts (a)–(c) survive as CR-2b below.
- **CR-1 (WS1, contracts, one optional field):** add `selected: z.array(z.object({ name: z.string(), label: z.string() })).max(3).optional()` to `GetProductInputSchema.catalog`. Shopify's live `get_product` accepts it, and WS3 uses it to narrow variants and report option availability (§4.3). Without it, WS3 ignores selection.
- **CR-2 (WS2 and WS4, registrars):**
  - (a) Do **not** call `logAgentRequest` from `registerCrawlTools` / `registerCheckoutTools`. WS3's `instrumentServer` logs every tool call once, with its store id when `structuredContent` carries `store.id` / `store_id`. This supersedes 00 §4.5's per-tool logging line for the MCP surface; REST routes still log themselves.
  - (b) WS4, carried over from round 1: accept the UCP/Shopify line-item form `{ item: { id }, quantity }` alongside `{ variant_id, quantity }`. Until the service is ready, return a handoff `requires_escalation` session rather than `not_implemented` (synthesis §5). Set `destructiveHint: true` on `complete_checkout`.
- **CR-3 (ownership):** WS3 also owns:
  - `src/infrastructure/mcp/instrument.ts`, `src/infrastructure/mcp/instructions.ts`;
  - `src/features/catalog/**`;
  - `src/app/.well-known/ucp/[version]/route.ts`;
  - `src/features/catalog/formats/{llms,permalink,openapi,agent-card,text}.ts`, in addition to 00 §3.1's `formats/{shopify,ucp,acp}.ts`.
- **CR-4 (WS1, optional):** expose DECISIONS §A's `stores.best_method` on `Store`/`StoreSummary` (for example `best_method: AccessMethod | "none" | null`), so `list_stores` and the root llms.txt can show it without per-store scan queries. Without it, those two surfaces show only the grade.
- **CR-5 (optional, WS3 migration):** `agent_requests.agent_profile text`; until then the profile is only logged via `log.info`.
