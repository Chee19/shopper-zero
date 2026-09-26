# Binding decisions (round 2)

These decisions settle every conflict between specs 00–05 and add the **scan-and-score** feature. Where a spec disagrees with this file, this file wins. Spec 00 folds these in as the canonical contracts.

## A. New feature: scan and score (the entry experience)

A visitor pastes a store URL and hits **Scan**. A *discovery agent* checks how an AI assistant could use the store, trying three access methods **in order** and stopping at the first that works. The result is an **Agent Readiness Score**, followed by the offer "make it agent-ready" (indexing, then our UCP/MCP endpoints, which gives a grade of A).

| # | Access method | What it is | How we probe it |
|---|---|---|---|
| 1 | `api` | A machine interface an agent can call directly | `/.well-known/ucp`, MCP discovery, ACP feed, Shopify `products.json`, platform APIs (Woo Store API, Magento GraphQL, Squarespace `?format=json`, SFCC) |
| 2 | `dom` | Web scraping: reading the page structure (HTML/DOM, JSON-LD, microdata, accessibility tree) to know what to read and **where to click** | Sitemaps + JSON-LD/microdata extraction, then a DOM agent (Stagehand `observe`/`extract` on a real browser, or cheerio + LLM on fetched HTML) that locates: search box, product card, price, variant picker, add-to-cart, cart and checkout link. Output is a reusable **interaction recipe** (selectors) |
| 3 | `computer_use` | Screenshots plus a vision LLM decide each click | Claude computer use driving a real browser (Browserbase, or local Playwright), capped at 15 steps: home → product → add to cart → reach checkout. **Always stop before payment.** Screenshots are streamed to the UI |

Rules:
- **Cascade by default** (`mode: "cascade"`). Try `api`; if it fails, try `dom`; if that fails, try `computer_use`. `mode: "full"` runs all three and is a stretch goal (for a before/after comparison).
- A method **passes** when an agent could at least list products with price and availability through it. It is **partial** when only some capabilities work.
- The score reflects the **best method achieved plus its capabilities**. API gives the highest band, DOM the middle band, computer use the lowest (it's slow and expensive), and none gives about 0. WS2 owns the exact weights and puts them in spec 02.
- Every probe reports the estimated **seconds and USD per agent task**. The comparison "API about 1 s / $0.00 vs computer use about 90 s / $0.30" is the headline of the report page.
- After a scan, indexing (the existing crawl) uses the best method found: `api` maps to the platform adapter, `dom` to the sitemap + JSON-LD / DOM recipe. `computer_use` does not index a catalog; the store is marked as reachable by computer use only.
- The DOM recipe is stored and later used by WS4's `browser` checkout connector (stretch).

### Contracts (add to `src/lib/contracts/scan.ts`; WS1 owns the file)

```ts
export type AccessMethod = "api" | "dom" | "computer_use";
export type ProbeStatus = "pending" | "running" | "passed" | "partial" | "failed" | "skipped" | "blocked";
export type Capabilities = {
  catalog: boolean; product_detail: boolean; price_availability: boolean;
  variants: boolean; cart: boolean; checkout_reachable: boolean;
};
export type ProbeSignal = { id: string; label: string; ok: boolean; detail?: string; url?: string };
export type DomRecipe = {
  search_input?: string; product_card?: string; product_link?: string; title?: string; price?: string;
  variant_picker?: string; add_to_cart?: string; cart_link?: string; checkout_link?: string;
  notes?: string; verified_at?: string;
};
export type AccessProbe = {
  method: AccessMethod;
  status: ProbeStatus;
  started_at: string | null; finished_at: string | null; duration_ms: number | null;
  signals: ProbeSignal[];
  capabilities: Capabilities;
  sample_products: number;
  est_seconds_per_task: number | null;
  est_usd_per_task: number | null;
  endpoints?: string[];            // api
  recipe?: DomRecipe;              // dom
  screenshots?: string[];          // computer_use: Supabase Storage public URLs, in order
  steps?: { i: number; action: string; reasoning?: string; screenshot?: string }[];  // computer_use
  error?: { code: string; message: string };
};
export type ScanMode = "cascade" | "full";
export type ScanStatus = "queued" | "running" | "done" | "failed";
export type ScanReport = {
  id: string; store_id: string; url: string; mode: ScanMode; status: ScanStatus;
  platform: Platform;
  best_method: AccessMethod | "none";
  probes: AccessProbe[];            // in cascade order; untried methods are "skipped"
  score: number;                    // 0–100
  grade: "A" | "B" | "C" | "D" | "F";
  checks: ReadinessCheck[];         // existing readiness checks, still shown
  after: { score: number; grade: "A" | "B" | "C" | "D" | "F" } | null;  // projected / actual via ShoperZero
  recommendations: string[];
  created_at: string; updated_at: string;
};
```

### Database (WS1 adds these to the core migration)
- **`scans` table:** `id`, `store_id`, `url`, `mode`, `status`, `platform`, `best_method`, `probes jsonb`, `score`, `grade`, `checks jsonb`, `after jsonb`, `recommendations jsonb`, timestamps. Public read, service-role write, added to the Realtime publication.
- **`stores` columns:** `best_method text`, `dom_recipe jsonb`, `latest_scan_id uuid`.
- **Storage bucket** `scan-screenshots`, public read.

### API and MCP
- `POST /api/v1/scans` `{url, mode?}` returns `202 {scan_id, store_id, status_url}`. `GET /api/v1/scans/{id}` returns a `ScanReport`. WS2 owns both.
- `POST /api/v1/stores` (index) stays as it is. It can take `{url}` or `{store_id}`, and reuses the latest scan.
- New MCP tool `scan_store` `{url}` returns `{scan_id, status_url}`, and `get_scan` `{scan_id}` returns a `ScanReport`. WS2's registrar owns them.

### Ownership
- **WS2** owns `src/lib/scan/**` (`probes/api.ts`, `probes/dom.ts`, `probes/computer-use.ts`, `score.ts`, `run.ts`) and `src/app/api/v1/scans/**`. `computer-use.ts` can be handed to a third person without touching anything else.
- **WS5** makes **scan and score the primary landing flow**: `/` has the URL input, `/scan/{id}` shows the live cascade (one card per method, streamed screenshots for computer use) and then the score report with an "Make it agent-ready" CTA, which starts indexing and ends at the store page with a grade of A.
- New env vars: `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID` (optional; local Playwright otherwise), `ANTHROPIC_API_KEY` (now core, not stretch), `SCAN_CU_MAX_STEPS=15`, `SCAN_CU_ENABLED=1`.

## B. Conflicts resolved

| # | Conflict | Decision |
|---|---|---|
| 1 | Ownership of `src/app/api/v1/stores/route.ts` | **WS2 owns GET and POST** (as 00 says). WS3 does not touch it. WS3 owns `stores/[slug]/route.ts`. |
| 2 | Readiness signature | `computeReadiness(store, phase)` from 00. Its `before` value is derived from the latest `ScanReport`. WS2 drops `computeReadiness(domainOrUrl)` and `computeAfterReadiness`. |
| 3 | Claim tokens | 00 wins: a service-role-only `store_claims` table. There is no `stores.claim_token`. WS5's claim API reads and writes through service-role helpers. |
| 4 | Crawl/scan MCP tools | Registrars are per stream: `registerCrawlTools(server)` (WS2: `index_store`, `get_crawl_status`, `scan_store`, `get_scan`), `registerCheckoutTools(server)` (WS4, including `get_order`), and WS3's catalog tools. WS3's `/api/mcp` route composes all three. The tool schemas WS3 already wrote move verbatim into WS2's spec. |
| 5 | `CheckoutConnector.quote` | Takes `QuoteInput` (00). `continueUrl(store, lines)` (00). `CheckoutState` includes `handoff`, which maps to `requires_escalation`. WS4 adapts. |
| 6 | x402 pay route | `POST /api/v1/checkouts/{id}/pay/x402` (WS4 CCR-W4-1 accepted). |
| 7 | MCP/REST product shape | The UCP product shape is the default; raw `IndexedProduct` is available via `?format=indexed` (WS3 CR-8 accepted). `structuredContent` equals the REST body. |
| 8 | `/api/mcp` `maxDuration` | 300 (WS2 CCR-7 accepted). |
| 9 | Woo ids | `variant.external_id` is the Store API purchasable id; `product.external_id` is the Woo product id (CCR-W4-4 accepted). |
| 10 | Checkout connector choice | Everyone calls `resolveCheckoutConnector(store)` from WS4 (CCR-W4-5 accepted). |
| 11 | Error envelope | `{error: {code, message, details?}}` with 00's code table. |
| 12 | DB helpers | WS1 adds everything requested: `getStoreById`, `rowToStore`, `listStores`, `listStoreProducts`, `findProducts`, `getLatestCrawlRun`, `getIndexStats`, the `upsertStoreProducts` semantics from WS2 CCR-1, plus `getScan`, `upsertScan`, `getLatestScanForStore`. |
| 13 | Env vars | 00 keeps the union of all streams' env vars plus section A's. |
| 14 | WS5 CCRs 1–11 | Accepted, except CCR-8's `claim_token`, which follows B3. |
| 15 | Extra migrations | Streams may add their own migrations with later timestamps (e.g. WS4's `20260926024000_ws4_checkout.sql`). They never edit the core migration. |
| 16 | `/bot` page | WS5 adds `/bot`, which explains the crawler and how to opt out. |
