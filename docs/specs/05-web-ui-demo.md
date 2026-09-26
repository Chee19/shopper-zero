# 05: WS5 Web UI, demo and pitch

Implementation spec for workstream 5. A coding agent that has not read the research should be able to follow it top to bottom without asking questions. Anything that could not be checked is marked **UNVERIFIED**, with a fallback.

## Round-2 changes

This revision follows `docs/specs/DECISIONS.md`, which is binding.

- **Scan and score is now the primary flow.**
  - `/` is a single URL input with a **Scan** button, which calls `POST /api/v1/scans`.
  - `/scan/{id}` shows the live cascade: three method cards (API → Web scraping/DOM → Computer use), fed by Realtime on `scans` UPDATE with polling of `GET /api/v1/scans/{id}` as the fallback.
  - The **score report** follows: big grade, method comparison, checks, recommendations, and a "Make it agent-ready" CTA.
  - The CTA calls `POST /api/v1/stores {store_id}`. An inline indexing lane (the round-1 crawl lane) takes over, and the flow ends on `/stores/{slug}` with the grade animating to **A**.
- The round-1 multi-store view (`/scan?runs=…`) is **removed**. The crawl lane survives as a component inside `/scan/{id}`.
- Contract names now come from spec 00 and DECISIONS §A. The scan types are `ScanReport`, `AccessProbe`, `AccessMethod`, `ProbeStatus`, `Capabilities`, `ProbeSignal` and `DomRecipe`. DB helpers include `getScan`, `getLatestScanForStore`, `getStoreById`, `listStores`, `listStoreProducts`, `getPublicMetrics` and `listCheckoutEvents`. The error envelope is `{error:{code,message,details?}}` (B11).
- **B3 claims:** tokens live in the service-role-only `store_claims` table. WS5 goes through `getClaim`, `upsertClaim`, `markClaimVerified` and `setStoreOptOut` from `@/infrastructure/database`. There is no `stores.claim_token` and no `metadata.claim`. The token strings follow spec 00: TXT `shoperzero-verify=<token>` and `<meta name="shoperzero-verify">`.
- **B16:** a new static `/bot` page describes the crawler and scanner and explains how to opt out.
- Mock fixtures now include one `ScanReport` per `best_method` (`api`, `dom`, `computer_use`, `none`). The computer-use fixture has offline SVG screenshots and a step log.
- The demo script now opens on a live scan that lands in `dom` with a poor grade, then goes Make agent-ready → A → Claude buys.
- The acceptance criteria and CCRs are rewritten. §12 lists the round-1 CCRs as accepted (B14) and adds the round-2 requests.

---

**Source of truth, in priority order:**
1. `docs/specs/DECISIONS.md`;
2. `docs/specs/00-overview-and-contracts.md` (canonical TS contracts and db helper signatures);
3. `docs/research/00-SYNTHESIS.md`.

Where this spec disagrees with a sibling spec about that sibling's own files, the sibling wins. For WS5 files, this spec wins.

**Stack:** Next.js **16.3.6** App Router, React 19.2, Tailwind v4, Supabase (`@supabase/ssr`, `@supabase/supabase-js`). **Read `AGENTS.md` first.** §4 lists the Next 16 behaviors this stream depends on, checked against `node_modules/next/dist/docs/`.

**Packages:** WS5 installs **nothing**. It uses only the base install plus WS1's T+0 union install (`zod`, `cheerio`, …). §8.6 explains why.

---

## 1. Scope

**In scope:**
1. **Landing `/`:** value proposition, one URL input, a **Scan** button, preset chips, "how we score" (the three access methods and their cost), the metrics strip, and recently scanned stores.
2. **Scan `/scan/{id}`**, in four phases on one page:
   - (a) the live cascade, one card per `AccessMethod`;
   - (b) the score report;
   - (c) indexing progress after "Make it agent-ready";
   - (d) the hand-off to the store page.
3. **Store page `/stores/{slug}`:** the grade animating from the scan grade to A, links to every agent surface, a "Connect to Claude" snippet with copy, and the product grid. `/stores` is a small index.
4. **Checkout timeline:** `/checkouts/{id}`, plus `/checkouts/live`, which follows the latest checkout. Realtime on `checkout_events`, with links to the Stripe PaymentIntent and the Woo order.
5. **Claim `/claim/{slug}`** and `POST /api/v1/claims`, backed by `store_claims`.
6. **Metrics strip:** stores scanned (split by best method), products normalized, time to agent-ready, agent checkouts.
7. **`/bot`:** crawler and scanner disclosure, plus opt-out instructions (B16).
8. **Mock mode and replay**, so the UI works before WS2/WS4 land and still works on stage when something fails.
9. **Demo material** in `docs/demo/`.

**Out of scope:**
- WS5 does no probing, scoring, crawling, MCP, checkout or payments.
- WS5 never writes to `scans`, `products`, `crawl_runs`, `checkouts`, `checkout_events` or `orders`.
- WS5 writes only through the claim helpers: `store_claims`, `stores.claimed_at` and `stores.opted_out`.

---

## 2. Owned files

Synthesis §5, spec 00: `src/app/page.tsx`, `src/app/(site)/**`, `src/components/**`, `src/app/layout.tsx`/`globals.css`, `src/app/api/v1/claims/**`, `docs/demo/**`, `mock/`.

```
src/app/layout.tsx                          EDIT: fonts, TopBar, Footer
src/app/globals.css                         REWRITE: tokens + Tailwind v4 @theme (§8.3)
src/app/page.tsx                            REWRITE: landing (/)
src/app/not-found.tsx                       NEW

src/app/(site)/error.tsx                    NEW (client error boundary)
src/app/(site)/scan/page.tsx                NEW: /scan (no id) → form only
src/app/(site)/scan/[id]/page.tsx           NEW: /scan/{id} (cascade → report → indexing)
src/app/(site)/scan/[id]/loading.tsx        NEW
src/app/(site)/stores/page.tsx              NEW: /stores
src/app/(site)/stores/[slug]/page.tsx       NEW
src/app/(site)/stores/[slug]/loading.tsx    NEW
src/app/(site)/stores/[slug]/not-found.tsx  NEW
src/app/(site)/checkouts/[id]/page.tsx      NEW
src/app/(site)/checkouts/live/page.tsx      NEW (a static segment beats [id])
src/app/(site)/claim/[slug]/page.tsx        NEW
src/app/(site)/bot/page.tsx                 NEW: /bot (B16), static

src/app/(site)/_lib/env.ts                  UI_MOCK flag
src/app/(site)/_lib/queries.ts              server-only reads (each starts with `await connection()`)
src/app/(site)/_lib/metrics.ts              server-only getUiMetrics()
src/app/(site)/_lib/demo.ts                 demo presets (scan targets)
src/app/(site)/_lib/mock.ts                 re-exports mock/fixtures (relative import)

src/app/api/v1/claims/route.ts              POST /api/v1/claims
src/app/api/v1/claims/_verify.ts            DNS TXT + meta-tag checks

src/components/ui/*          Button, Card, Chip, StatusDot, LivePill, CopyButton, CodeBlock, GradeTile,
                             ScoreRing, CountUp, Skeleton, EmptyState, ErrorState, Tabs, Dialog, icons.tsx
src/components/site/*        TopBar, Footer, ThemeToggle (stretch)
src/components/scan/*        ScanForm, ScanExperience (phase controller), CascadeBoard, MethodCard,
                             SignalList, CapabilityRow, CostLine, ApiEndpoints, DomRecipePreview,
                             ComputerUseViewer, StepLog, ScoreReport, MethodComparison, ChecksList,
                             Recommendations, AgentReadyCta, IndexingPanel, CrawlLane, StageRail, CrawlLog
src/components/store/*       StoreHeader, GradeHero, AgentSurfaces, ConnectAgent, ProductGrid, ProductCard, RescanButton
src/components/checkout/*    CheckoutTimeline, StateRail, EventRow, CheckoutSummary, PaymentLinks
src/components/claim/*       ClaimFlow
src/components/metrics/*     MetricsStrip (server), AutoRefresh (client)
src/components/realtime/*    supabase-browser.ts, useScan.ts, useCrawlLane.ts, useCheckoutFeed.ts, replay.ts
src/components/lib/*         format.ts (money/time/grade), methods.ts (labels, bands, typical cost), log.ts (CrawlLogEntry normalizer)

mock/fixtures/*.ts           typed fixtures (§9)
mock/fixtures/shots.ts       offline SVG screenshot generator for computer-use fixtures
mock/recorded/*.json         real runs exported after rehearsal
mock/seed-ui.sql             optional local seed
demos/prototypes/original/index.html              EXISTING earlier-concept design mock. Keep it and do not edit it.
                             It is the visual reference for §8.

docs/demo/runbook.md  docs/demo/script.md  docs/demo/qa.md   (copied from §10)
```

**Never edit** `src/lib/**`, `src/proxy.ts`, `supabase/**`, `package.json` or other streams' routes. Changes to those go through §12.

---

## 3. Interfaces consumed

Import types from `@/contracts` (barrel; the scan types live in `scan.ts`). Import helpers from `@/infrastructure/database`.

| Need | Provider | Name (exact) | Fallback if not landed |
|---|---|---|---|
| Scan types | WS1 | `ScanReport`, `AccessProbe`, `AccessMethod`, `ProbeStatus`, `Capabilities`, `ProbeSignal`, `DomRecipe`, `ScanMode`, `ScanStatus` | Temporary copy in `mock/fixtures/_contracts.ts`; delete it when WS1 lands |
| Other types | WS1 | `Store`, `StoreSummary`, `CrawlRun`, `CrawlLogEntry`, `ReadinessCheck`, `ReadinessGrade`, `gradeFor`, `IndexedProduct`, `CheckoutSession`, `CheckoutState`, `STATE_TO_STATUS`, `CheckoutEvent`, `Order`, `Money`, `Platform`, `PaymentRailId`, `StoreClaim`, `ClaimMethod`, `PublicMetrics` | Same |
| Start a scan | WS2 | `POST /api/v1/scans {url, mode?}` → `202 {scan_id, store_id, status_url}` | Mock/replay |
| Read a scan | WS2 / WS1 | `GET /api/v1/scans/{id}` → `ScanReport`; server: `getScan(id)` | Direct select on `scans` (public read) |
| Latest scan of a store | WS1 | `getLatestScanForStore(storeId)` | Select `scans` by `store_id` order `created_at desc` limit 1 |
| Start indexing | WS2 | `POST /api/v1/stores {store_id \| url, force?, max_products?}` → 202/200 `{store, crawl_run_id, status, reused, cached}` | Replay the indexing frames |
| Crawl progress | WS2 | `GET /api/v1/crawl-runs/{id}`, Realtime on `crawl_runs` | Realtime only |
| Store | WS1 / WS3 | `getStoreBySlug`, `getStoreById`, `listStores`; REST `GET /api/v1/stores/{slug}` (a `Store` plus `latest_crawl_run`) | — |
| Products | WS1 | `listStoreProducts(storeId, {limit, page})` → `{products, total}` | — |
| Checkout | WS4 | `getCheckout(id)` from `@/features/checkout/service` (throws when missing); `GET /api/v1/checkouts/{id}` | Events only |
| Checkout events | WS1 | `listCheckoutEvents(checkoutId)`; Realtime on `checkout_events` | Browser select |
| Claims | WS1 | `getClaim(storeId)`, `upsertClaim(storeId, method)` (**rotates the token**), `markClaimVerified(storeId)`, `setStoreOptOut(storeId, optedOut)` | none: the claim flow is a slide (cut item 8) |
| Metrics | WS1 | `getPublicMetrics(): PublicMetrics` | Mock numbers |
| HTTP helpers | WS1 | `route`, `json`, `errorResponse`, `parseJsonBody`, `preflight` (`@/shared/http`), `AppError` (`@/shared/errors`), `appUrl()`, `flags.crawlerUserAgent()` (`@/shared/env`) | Inline equivalents |
| Supabase clients | scaffold | `@/infrastructure/supabase/{client,server,admin}` | — |

---

## 4. Next 16 rules for this stream (checked in `node_modules/next/dist/docs/`)

1. **`params` and `searchParams` are Promises.**
   - Pages: `export default async function Page(props: PageProps<'/scan/[id]'>) { const { id } = await props.params }`.
   - `PageProps`, `LayoutProps` and `RouteContext` are global generated types, so no import is needed.
2. **Cache Components are off** (there is no `cacheComponents` in `next.config.ts`).
   - A page with no request-time API gets prerendered at build. The admin/`db()` client uses no cookies.
   - So **every `_lib` server function starts with `await connection()`** (`import { connection } from "next/server"`).
3. **Server Components by default.** Add `'use client'` only to interactive leaves: forms, Realtime hooks, CTA, copy, tabs, count-ups, and the screenshot viewer. Props must be serializable: plain JSON, no `Date` objects or functions.
4. **`error.tsx` is a Client Component** and receives `{ error, retry }`. `retry` is stable since 16.3.0; use it rather than `reset`. `loading.tsx` wraps the segment in Suspense.
5. **Routing rules:**
   - Route group `(site)` does not change URLs, and `_lib` / `_verify.ts` are private (not routable).
   - A static `checkouts/live` wins over `checkouts/[id]`.
   - `scan/page.tsx` and `scan/[id]/page.tsx` coexist.
6. **`proxy.ts` belongs to WS1.** Its matcher skips `api/`, `s/`, `.well-known/` and the others. `/scan/x` is not matched by the `s/` exclusion, because that pattern is anchored at the path start.
7. **Merchant images and screenshots use a plain `<img>`.** Merchant images are hotlinked from arbitrary domains (we never re-host them), and `next/image` would need an open `remotePatterns`. Computer-use screenshots are Supabase Storage public URLs or `data:` SVGs in mock mode.

---

## 5. Customer flow and sitemap

```
/ (URL + Scan) ──POST /api/v1/scans──▶ /scan/{id}
                                        ├─ phase A  cascade: [API] ─fail─▶ [DOM] ─fail─▶ [Computer use]   (Realtime scans UPDATE)
                                        ├─ phase B  score report: grade · method comparison · checks · recommendations · CTA
                                        ├─ phase C  "Make it agent-ready" ──POST /api/v1/stores {store_id}──▶ indexing lane
                                        │           (URL becomes /scan/{id}?run={crawl_run_id}; Realtime crawl_runs + stores)
                                        └─ phase D  "Agent-ready: A" ──auto 2.5 s──▶ /stores/{slug}?from_scan={id}  (grade flips D→A)
/stores/{slug} ──ConnectAgent──▶ Claude ──MCP create/complete_checkout──▶ /checkouts/live (timeline)
/claim/{slug} ◀── "Is this your store?" (report, store page, blocked/computer-use CTAs)
```

| Route | File | Kind | Data | Realtime |
|---|---|---|---|---|
| `/` | `src/app/page.tsx` | Server + client `ScanForm`, `AutoRefresh` | `getUiMetrics()`, `getRecentStores(6)`, `DEMO_PRESETS` | — (refresh every 10 s) |
| `/scan` | `(site)/scan/page.tsx` | Server | — | — |
| `/scan/{id}` | `(site)/scan/[id]/page.tsx` | Server + client `ScanExperience` | `getScanView(id, runId?)` | `scans` UPDATE `id=eq.{id}`; after the CTA, `crawl_runs` + `stores` UPDATE |
| `/scan/replay-{fixture}` | same route | same | fixture (§9) | replay timers |
| `/stores` | `(site)/stores/page.tsx` | Server | `listStores({limit: 50})` | — |
| `/stores/{slug}` | `(site)/stores/[slug]/page.tsx` | Server + client leaves | `getStoreView(slug, fromScan?)` | — |
| `/checkouts/{id}` | `(site)/checkouts/[id]/page.tsx` | Server + client `CheckoutTimeline` | `getCheckoutView(id)` | `checkout_events` INSERT `checkout_id=eq.{id}` |
| `/checkouts/live` | `(site)/checkouts/live/page.tsx` | Server shell + client | `getLatestCheckoutId()` | `checkout_events` INSERT (unfiltered) |
| `/claim/{slug}` | `(site)/claim/[slug]/page.tsx` | Server + client `ClaimFlow` | `getStoreBySlug` | — |
| `/bot` | `(site)/bot/page.tsx` | Server, static | — | — |
| `POST /api/v1/claims` | `api/v1/claims/route.ts` | Route handler | claim helpers | — |

**TopBar** (root layout):
- brand "ShoperZero" → `/`;
- links `Scan` (`/`), `Stores`, `Live checkout`, `Agent docs` (`/llms.txt`, opens in a new tab);
- on the right, a mono chip `…/api/mcp` with a copy button.

**Footer:** "ShoperZeroBot honors robots.txt and Content-Signal · About our bot (/bot) · Claim or opt out."

---

## 6. Shared UI data layer

### 6.1 `_lib/env.ts`

```ts
export const UI_MOCK = process.env.NEXT_PUBLIC_UI_MOCK === "1";
export { appUrl } from "@/shared/env";      // WS1; fallback: (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")
```

**Rule:** when `UI_MOCK` is true, never construct a Supabase client and never import `@/infrastructure/database`, since that module is server-only and would create a client. The UI must render with no Supabase env at all, so `_lib/queries.ts` imports db helpers lazily: `const db = await import("@/infrastructure/database")` inside the non-mock branch.

### 6.2 `_lib/queries.ts` (server-only)

Every function starts with `import "server-only"` at the top of the file, then `await connection()`, then the `UI_MOCK` branch.

```ts
export type ScanView = {
  scan: ScanReport;
  store: Store | null;
  run: CrawlRun | null;              // only when ?run= is present (indexing phase) or a crawl is already running for the store
  replay: ScanReplay | null;         // only for replay ids
};
getScanView(id: string, runId?: string): Promise<ScanView | null>
  // id = uuid | "replay-<fixture>". Replay → mock fixtures/recorded. Else getScan(id) → null → notFound();
  // store = getStoreById(scan.store_id); run = runId ? getCrawlRun(runId) : null
getRecentStores(limit = 6): Promise<StoreSummary[]>           // listStores({ limit }) sorted by updated_at desc
getStoreView(slug, fromScan?): Promise<{ store: Store; products: IndexedProduct[]; total: number;
                                        scan: ScanReport | null } | null>
  // store = getStoreBySlug (returns opted-out stores too; B14/CCR-8);
  // products = opted_out ? [] : listStoreProducts(store.id, { limit: 48, page: 1 });
  // scan = fromScan ? getScan(fromScan) : getLatestScanForStore(store.id)
getCheckoutView(id): Promise<{ checkout: CheckoutSession | null; events: CheckoutEvent[] }>
  // checkout: try { await getCheckout(id) } catch { null };  events: listCheckoutEvents(id)
getLatestCheckoutId(): Promise<string | null>                  // newest checkout_events row (admin/db client)
```

Validate ids with `/^[0-9a-f-]{36}$/i`, or `/^replay-[a-z0-9-]{1,40}$/` for scan replays. Anything else calls `notFound()`.

### 6.3 Realtime hooks (`src/components/realtime/`)

`supabase-browser.ts` holds one browser client per tab: `export const browserSupabase = () => (client ??= createClient())`, where `createClient` comes from `@/infrastructure/supabase/client`.

All hooks follow the same pattern:
- a unique channel topic (`${table}:${id}:${crypto.randomUUID()}`), so a StrictMode double mount does not collide;
- `mode` is one of `"connecting" | "live" | "polling" | "replay"`;
- on `SUBSCRIBED`, call `reconcile()` once, which re-reads the row through REST and closes the gap between SSR and the subscription;
- on `CHANNEL_ERROR`/`TIMED_OUT`, switch to polling every 2 s;
- a **watchdog** calls `reconcile()` if a non-terminal row gets no event for 8 s;
- `sb.removeChannel(ch)` on unmount.

**`useScan(initial: ScanReport, replay?: ScanReplayFrame[])`** returns `{ scan, mode }`.
- Listen for `postgres_changes` UPDATE on `public.scans` with filter `id=eq.{id}`, and set `scan = rowToScanReport(p.new)`.
- `rowToScanReport` maps the columns one-to-one to the `ScanReport` fields. Timestamps are already ISO strings.
- **Payload guard:** if `p.new.probes` is not an array (the payload was truncated or oversized; the Realtime payload limit is **UNVERIFIED**), call `reconcile()` instead.
- `reconcile()` → `GET /api/v1/scans/{id}`. If that returns 404 or 501 (WS2 not landed), use `browserSupabase().from("scans").select("*").eq("id", id).single()`.
- Terminal statuses are `done` and `failed`. Keep listening 3 s after a terminal status, so a late `after`/`recommendations` write still arrives.

**`useCrawlLane(initial: {run: CrawlRun; store: Store}, replay?)`**:
- listens for UPDATEs on `crawl_runs` (`id=eq`) and `stores` (`id=eq`);
- polls `GET /api/v1/crawl-runs/{id}` and `GET /api/v1/stores/{slug}` as the fallback;
- terminal statuses are `succeeded` and `failed`. Keep listening 3 s after terminal, for `readiness.after`.

**`useCheckoutFeed({ checkoutId | "latest", initialCheckout, initialEvents, replay? })`**:
- appends `checkout_events` INSERTs, deduped and sorted by `id`;
- re-fetches `GET /api/v1/checkouts/{id}` whenever `to_state` changes;
- in **follow mode**, switches to a new `checkout_id` when its first event arrives;
- polls as the fallback.

**Log normalizer (`components/lib/log.ts`):** spec 00 has `CrawlLogEntry {at, level, msg, data?}`, while spec 02 serves `{t, step, level, msg, data?}` (see §12 R2-5). Read the log tolerantly:

```ts
export const logTime = (e: any) => e.at ?? e.t ?? null;
export const logStep = (e: any) => e.step ?? e.data?.step ?? null;
```

The anon role can read `scans`, `stores`, `crawl_runs` and `checkout_events` (public-read RLS, and all are in `supabase_realtime`). `checkouts`, `orders` and `store_claims` are service-role only, so the UI never subscribes to them.

### 6.4 Formatting and method metadata

`components/lib/format.ts`:

| Function | Behavior |
|---|---|
| `formatMoney` | Minor units → `Intl.NumberFormat` using the currency's fraction digits |
| `formatRange` | Price range |
| `formatSeconds(s)` | `≈1 s`, `≈8 s`, `≈1.5 min` |
| `formatUsd(n)` | `$0.00`, `$0.01`, `$0.30`; always 2 decimals; `< $0.01` shows `<$0.01` |
| `elapsed` | `m:ss` |
| `ago` | "3 min ago" |
| `shortId` | Short id |
| `gradeTone` | A→`good`, B→`good2`, C→`warn`, D→`serious`, F→`bad` |
| `stripeUrl(pi)` | `https://dashboard.stripe.com/test/payments/${pi}` (**UNVERIFIED** for sandboxes; the id is always shown with copy) |

`components/lib/methods.ts` is used by cards, the comparison table and the landing explainer:

```ts
export const METHOD_ORDER: AccessMethod[] = ["api", "dom", "computer_use"];
export const METHOD_META: Record<AccessMethod, { label: string; short: string; blurb: string; band: string }> = {
  api:          { label: "API", short: "API", band: "Best",
                  blurb: "A machine interface agents call directly: UCP, MCP, products.json, platform APIs." },
  dom:          { label: "Web scraping (DOM)", short: "DOM", band: "Middle",
                  blurb: "Reading the page structure (JSON-LD, HTML, accessibility tree) to know what to read and where to click." },
  computer_use: { label: "Computer use", short: "Computer use", band: "Lowest",
                  blurb: "Screenshots plus a vision model decide every click. Slow and expensive. We stop before payment." },
};
/** Display-only fallback when a probe's estimate is null (e.g. a skipped method). Always labeled "typical". */
export const TYPICAL_COST: Record<AccessMethod, { s: number; usd: number }> = {
  api: { s: 1, usd: 0 }, dom: { s: 8, usd: 0.01 }, computer_use: { s: 90, usd: 0.3 },
};
export const CU_MAX_STEPS = 15;   // mirrors SCAN_CU_MAX_STEPS default; display only
export const CAPABILITY_LABELS: Record<keyof Capabilities, string> = {
  catalog: "Catalog", product_detail: "Details", price_availability: "Price & stock",
  variants: "Variants", cart: "Cart", checkout_reachable: "Checkout reachable",
};
```

`TYPICAL_COST` mirrors the headline in DECISIONS §A. The real values come from `AccessProbe.est_seconds_per_task` / `est_usd_per_task`, and §12 R2-3 asks WS2 to fill them for skipped probes too.

### 6.5 Surface URLs

Use `store.urls` from the contract (`page`, `products_json`, `llms_txt`, `feed`, `ucp`, `mcp`). The product JSON URL is `${appUrl()}/s/${slug}/products/${handle}.json`. The root discovery URLs are `${appUrl()}/llms.txt` and `${appUrl()}/.well-known/ucp`.

---

## 7. Pages

Every page exports `metadata` (or `generateMetadata` for dynamic pages), titled `"<thing> · ShoperZero"`.

### 7.1 Landing `/`

**Files:** `src/app/page.tsx` (server), `components/scan/ScanForm.tsx` (client), `components/metrics/{MetricsStrip,AutoRefresh}.tsx`.

**Data:**
- `getUiMetrics()`;
- `getRecentStores(6)`;
- `DEMO_PRESETS` from `_lib/demo.ts`: `{ label, url, note, demo: true }[]`. The URLs are chosen at T-60 (§10.1) and written into the file. Defaults are `https://www.berlinpackaging.com` ("expected: DOM"), `WOO_DEMO_URL` ("expected: API", passed as a prop from `process.env`) and `https://hester-demo.squarespace.com` ("expected: API").

**Copy:**
- Kicker: "Agent Readiness Score · free"
- H1: "Can an AI assistant **shop your store?**" (the bold phrase is set in the display italic)
- Lede: "Paste a store URL. Our discovery agent tries what a real assistant would: an API first, then reading the page, then clicking through screenshots. You get a grade, the cost per agent task, and a one-click fix: we host UCP, MCP, products.json and llms.txt for you."

**ScanForm (client):**
- One input "Store URL" and the button **Scan**.
- Normalize the input: trim, prepend `https://` if there is no scheme, keep the path, and validate with `new URL()`.
- Submit sends `POST /api/v1/scans` with `{ url, mode: "cascade" }`, then:

  | Result | Action |
  |---|---|
  | 202 | `router.push('/scan/' + scan_id + (preset ? '?demo=1' : ''))` |
  | 4xx | inline `error.message` (e.g. `validation_error` "That doesn't look like a store URL", `forbidden` "This merchant opted out") |
  | 5xx / network | inline "Couldn't start the scan. Retry", plus a link "Watch a recorded scan →" (`/scan/replay-dom`) |
  | `UI_MOCK` | push `/scan/replay-dom?demo=1` directly |

- While pending, the button shows a spinner and "Starting…", and is disabled.
- Preset chips sit below the form. A click fills the input; a double-click fills and submits.

**"How we score" band:** three compact cards in cascade order with arrows ("if it fails →"), built from `METHOD_META` and `TYPICAL_COST`: API "≈1 s · $0.00 per task", DOM "≈8 s · $0.01", Computer use "≈90 s · $0.30".

**States:**
- Metrics `null`: render the muted line "Metrics unavailable". `getUiMetrics` must never throw.
- No recent stores: hide that section.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ◼ ShoperZero        Scan  Stores  Live checkout  Agent docs  […/api/mcp ⧉]│
├──────────────────────────────────────────────────────────────────────────┤
│                ( • Agent Readiness Score · free )                        │
│               Can an AI assistant  shop your store?                      │
│     Paste a store URL. Our discovery agent tries what a real …           │
│   ┌──────────────────────────────────────────────────────┬──────────┐    │
│   │ Store URL  https://www.berlinpackaging.com           │  Scan →  │    │
│   └──────────────────────────────────────────────────────┴──────────┘    │
│   Try: [Berlin Packaging · expect DOM] [ShoperZero Demo · API] [Hester]  │
│                                                                          │
│   HOW WE SCORE                                                           │
│   ┌ 1 API ────────────┐ if it ┌ 2 Web scraping ───┐ if it ┌ 3 Computer use ┐
│   │ UCP/MCP/products  │ fails │ JSON-LD, DOM,     │ fails │ screenshots +  │
│   │ ≈1 s · $0.00/task │  ──▶  │ where to click    │  ──▶  │ vision clicks  │
│   │ Best band         │       │ ≈8 s · $0.01      │       │ ≈90 s · $0.30  │
│   └───────────────────┘       └───────────────────┘       └────────────────┘
│                                                                          │
│   ┌ STORES SCANNED ──────┬ PRODUCTS ┬ TIME TO AGENT-READY ┬ AGENT CHECKOUTS ┐
│   │ 9  ▆▆▆▃▂ api/dom/cu │ 1,042    │ 0:38 median         │ 3 · Stripe test │
│   └──────────────────────┴──────────┴─────────────────────┴─────────────────┘
│   RECENTLY SCANNED                                                       │
│   [D→A] berlinpackaging.com · BigCommerce · via DOM · 4 min ago       →  │
│   [B→A] demo-woo.example.com · WooCommerce · via API · 20 min ago     →  │
└──────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Scan `/scan/{id}`: cascade → report → indexing → store

**Files:**
- `(site)/scan/[id]/page.tsx` (server) and `loading.tsx` (three card skeletons);
- `components/scan/*` (client unless noted).

**Server page:**
1. `const { id } = await props.params` and `const sp = await props.searchParams`.
2. `view = await getScanView(id, typeof sp.run === "string" ? sp.run : undefined)`. If it is null → `notFound()`.
3. Render:
   ```tsx
   <ScanExperience scan={view.scan} store={view.store} run={view.run} replay={view.replay}
                   demo={sp.demo === "1"} appUrl={appUrl()} />
   ```

**`ScanExperience` (client, the phase controller)** uses `useScan`. Phase is derived, never stored:

| Condition | Phase |
|---|---|
| `scan.status` is `queued` or `running` | **A: cascade** |
| `scan.status === "failed"` | **A-failed**: `ErrorState` "The scan couldn't finish: {error of the last probe}". Buttons: "Scan again" (a new POST) and "Watch a recorded scan" |
| `scan.status === "done"` and no run | **B: report**. The cascade stays visible above it, collapsed to one summary row that can be expanded |
| a run exists (from `?run=` or after the CTA) | **C: indexing** |
| run `succeeded` and `store.readiness.after` exists | **D: ready**. Show the banner, then `setTimeout(2500)` → `router.push('/stores/'+slug+'?from_scan='+scan.id)`. A "Stay here" link cancels |

**Header, always shown:**
- "Scanning {domain}" (A) or "Agent Readiness Report · {domain}" (B–D);
- the platform chip once `scan.platform !== "unknown"`;
- a `LivePill` in phases A and C, or "Replay · recorded {date}" when `replay` is set;
- a clock from `scan.created_at`;
- a "Share" `CopyButton` for the page URL.

#### Phase A: CascadeBoard

Three `MethodCard`s in `METHOD_ORDER` (`grid lg:grid-cols-3`, stacked on mobile), joined by arrows with the caption "if it fails". Each card renders the matching `scan.probes.find(p => p.method === m)`. If the probe is missing, treat it as `pending`.

**Status chip (from `ProbeStatus`):**

| `ProbeStatus` | Chip |
|---|---|
| `pending` | "Waiting" (muted) |
| `running` | "Probing…" (accent, shimmer border on the card) |
| `passed` | "Works" (good) |
| `partial` | "Partial" (warn) |
| `failed` | "Failed" (bad) |
| `skipped` | "Not needed", or "Not tried" if nothing passed. The card collapses to a one-line compact form |
| `blocked` | "Blocked by bot protection" (warn), with the note "We don't bypass challenges" |

The card of `scan.best_method` gets a 2 px accent ring and the label "Best method found".

**MethodCard body:**
- Header: `METHOD_META[m].label`, the band chip, and a live duration (`duration_ms`, or ticking from `started_at` while running).
- **SignalList:** `probe.signals`, in arrival order. Each `ProbeSignal` shows as `✓`/`✗` + `label` + a muted `detail`, with `url` linked ↗. New rows animate in (`animate-rise`), and the list has `aria-live="polite"`. Show at most 8 rows plus "+n more", which expands.
- **CapabilityRow:** six mini pills from `probe.capabilities`, using `CAPABILITY_LABELS`, each ✓ (good tint) or ✗ (muted).
- **CostLine:** "≈{formatSeconds(est_seconds_per_task)} · {formatUsd(est_usd_per_task)} per agent task". When null, use `TYPICAL_COST[m]` followed by a muted "(typical)". Also show "{sample_products} sample products" when greater than 0.
- **Method-specific block:**
  - **API → `ApiEndpoints`:** `probe.endpoints` as mono links, at most 5.
  - **DOM → `DomRecipePreview`:** a `<dl>` of the `DomRecipe` keys present, in the order `search_input, product_card, title, price, variant_picker, add_to_cart, cart_link, checkout_link`. Labels: "Search", "Product card", "Title", "Price", "Variant picker", "Add to cart", "Cart", "Checkout". Values are mono selectors truncated to 40 characters with a `title` tooltip. Show 6 rows plus "+n more", then `notes` (muted) and "verified {ago(verified_at)}". Caption: "Reusable interaction recipe: where an agent reads and clicks."
  - **Computer use → `ComputerUseViewer`:**
    - a 16:10 frame drawn as a browser window (three dots and a URL-bar strip), showing the **latest** screenshot (`probe.screenshots.at(-1)`, or the last `steps[i].screenshot`). It crossfades (200 ms) when a new one arrives;
    - an overlay pill "Step {steps.length}/{CU_MAX_STEPS}" and a lock badge "Stops before payment";
    - below the frame, a filmstrip of 56 px thumbnails for every screenshot. Clicking one opens it full size in the native `<dialog>`;
    - **StepLog:** `steps` as `#{i} {action}` with `reasoning` in muted text, newest last, the last 6 visible, auto-scrolled;
    - while running with no screenshot yet, show a skeleton frame with "Launching browser…".

**Accessibility:** the screenshots get `alt="Step {i}: {action}"`. `prefers-reduced-motion` disables the crossfade.

```
┌ Scanning berlinpackaging.com  [BigCommerce]                         (● Live) 0:14 ┐
├ 1 API ─────── Failed ─┐ if it ┌ 2 Web scraping (DOM) ── Probing… ┐ if it ┌ 3 Computer use ─┐
│ ✗ /products.json 404  │ fails │ ✓ robots.txt allows agents        │ fails │ Waiting          │
│ ✗ /.well-known/ucp 404│  ──▶  │ ✓ sitemap: 1,204 product URLs     │  ──▶  │                  │
│ ✗ MCP discovery none  │       │ ✓ JSON-LD Product on 3/3 samples  │       │                  │
│ ✗ No platform API     │       │ ◌ locating add-to-cart…           │       │                  │
│ Catalog✗ Details✗ …   │       │ Catalog✓ Details✓ Price✓ Var✗ …   │       │                  │
│ ≈1 s · $0.00 (typical)│       │ RECIPE  Title   h1.productView-t… │       │ ≈90 s · $0.30    │
│                       │       │         Price   .price--main      │       │ (typical)        │
│                       │       │         Add     #form-action-add… │       │                  │
│                       │       │ ≈8 s · $0.01 per agent task       │       │                  │
└───────────────────────┘       └───────────────────────────────────┘       └──────────────────┘

Computer-use card while running (when DOM failed):
┌ 3 Computer use ─── Probing… ── 0:41 ──────────────────┐
│ ┌ ● ● ●  shop.example.com/products/trail-runner ────┐ │
│ │                [ latest screenshot ]               │ │
│ │  Step 6/15                  🔒 Stops before payment│ │
│ └────────────────────────────────────────────────────┘ │
│ [▣][▣][▣][▣][▣][▣]  filmstrip                           │
│ #5 click("Size 9")        variant picker is a dropdown │
│ #6 click("Add to cart")   button below price           │
│ ≈94 s · $0.31 per agent task                           │
└────────────────────────────────────────────────────────┘
```

#### Phase B: ScoreReport

Order of sections, top to bottom:

1. **Grade hero (Card):**
   - `ScoreRing` (150 px) with `scan.score` counting up, and a `GradeTile` (xl, 96 px) showing `scan.grade` in its tone;
   - verdict H2, keyed by `best_method`:
     - `api`: "Agents can use {domain} through an API."
     - `dom`: "Agents can reach {domain} only by scraping its pages."
     - `computer_use`: "Agents can reach {domain} only by clicking through screenshots."
     - `none`: "Agents can't use {domain} today."
   - subline: "An AI assistant needs ≈{s} and {usd} for every task here." (the numbers come from the best probe);
   - when `scan.after` exists, a right-side block "With ShoperZero: {after.grade} · {after.score}", with an arrow from the grade tile and the note "projected".
2. **MethodComparison:** the headline row states the contrast in words, e.g. **"API ≈1 s / $0.00 vs computer use ≈90 s / $0.30 per task."** Then a table with one row per method plus the row "Via ShoperZero (UCP + MCP)":

   | Method | Result | Time/task | Cost/task | Capabilities |
   |---|---|---|---|---|
   | API | Failed | ≈1 s (typical) | $0.00 | 0/6 |
   | Web scraping | **Works** | ≈8 s | $0.01 | 4/6 |
   | Computer use | Not tried | ≈90 s (typical) | $0.30 | — |
   | **Via ShoperZero** | after indexing | ≈1 s | $0.00 | 6/6 (projected) |

   Time and cost also render as horizontal bars on a log scale, so a 90× difference stays visible.
3. **ChecksList:** `scan.checks` (`ReadinessCheck[]`) as a two-column pass/fail list with `label`, `detail` and a weight chip.
4. **Recommendations:** `scan.recommendations` as a numbered list. Empty → hide.
5. **AgentReadyCta (client):**
   - For `best_method` `api` or `dom`:
     - title "Make it agent-ready";
     - body "We'll index the catalog using the {method} path we just found and host UCP, MCP, products.json, an ACP feed and llms.txt for {domain}. No plugin, no code.";
     - primary button **Make it agent-ready**;
     - secondary: "Is this your store? Claim it" → `/claim/{slug}`.
   - For `computer_use` or `none`:
     - title "Only a merchant can fix this one";
     - body "No machine-readable catalog was found. Claim the store to connect a feed or install our plugin.";
     - primary **Claim this store** → `/claim/{slug}`;
     - secondary **Try indexing anyway** (the same POST). DECISIONS §A says computer use does not index a catalog, so this may fail honestly.
   - If `store.opted_out`: hide the CTA and show "The merchant opted out."
   - **Click behavior:**
     - `POST /api/v1/stores` with `{ store_id: scan.store_id, force: true, ...(demo ? { max_products: 40 } : {}) }`;
     - 202/200 → `router.replace('/scan/'+id+'?run='+crawl_run_id+(demo?'&demo=1':''))`, then scroll to the indexing panel;
     - if the response has `cached: true`, the lane shows as already done;
     - errors: 409 `conflict`/blocked → "Blocked by bot protection. The merchant can claim to opt in"; any other error → `error.message` plus Retry;
     - the button is disabled while pending.

#### Phase C: IndexingPanel

A single **CrawlLane** (`useCrawlLane`), full width:
- the heading "Making {domain} agent-ready", with the strategy chip (`platform_api` → "Platform API", `jsonld` → "Sitemap + JSON-LD", …);
- a big `CountUp` of `run.products_found` and pages fetched/failed;
- a progress bar, determinate from the latest log entry with `data.total_estimate` (capped at `max_products`), otherwise a shimmer;
- **StageRail:** `Detect · Discover · Extract · Publish · Grade`, driven by `logStep()`, or derived from the fields when the log has no steps;
- **CrawlLog:** the last 6 entries, using `logTime()`;
- `GradeTile` before (= `scan.grade`) → after (shimmer "grading…" until `store.readiness.after`, then a flip to A).

On `failed`, show the error and "Retry". On `store.status === "blocked"`, show the honest blocked copy with a claim link.

#### Phase D: ready

A good-tone banner: "{domain} is agent-ready: **{grade}**. Agents can now search and buy." Buttons: **Open agent surfaces** → `/stores/{slug}?from_scan={id}`, and "Connect Claude" → `/stores/{slug}?from_scan={id}#connect`. The page auto-navigates after 2.5 s unless the viewer clicked "Stay here".

```
┌ Agent Readiness Report · berlinpackaging.com  [BigCommerce]                      Share ⧉ ┐
│ ┌──────┐  ┌───┐   Agents can reach berlinpackaging.com only by       With ShoperZero       │
│ │  48  │  │ D │   scraping its pages.                          ──▶   ┌───┐ 96 (projected) │
│ │ /100 │  └───┘   An AI assistant needs ≈8 s and $0.01 per task.     │ A │                 │
│ └──────┘                                                             └───┘                 │
├ HOW AGENTS CAN REACH IT ─────────────────────────────────────────────────────────────────┤
│ API ≈1 s / $0.00 vs computer use ≈90 s / $0.30 per task                                   │
│ API              Failed     ▏1 s        ▏$0.00   0/6                                      │
│ Web scraping     Works      ▇▏8 s       ▇▏$0.01  4/6   ← best found                       │
│ Computer use     Not tried  ▇▇▇▇▇▏90 s  ▇▇▇▇▇▏$0.30 —                                     │
│ Via ShoperZero   projected  ▏1 s        ▏$0.00   6/6                                      │
├ CHECKS ─────────────────────────────┬ RECOMMENDATIONS ───────────────────────────────────┤
│ ✗ products.json (15)  ✓ sitemap (10)│ 1. Publish a UCP profile at /.well-known/ucp        │
│ ✗ /.well-known/ucp    ✓ JSON-LD     │ 2. Expose an MCP endpoint for catalog search        │
│ ✗ MCP endpoint        ✓ robots      │ 3. Add variant data to Product JSON-LD              │
├─────────────────────────────────────┴───────────────────────────────────────────────────┤
│  Make it agent-ready. We'll index the catalog via web scraping and host UCP, MCP,        │
│  products.json, an ACP feed and llms.txt.   [ Make it agent-ready → ]  Is this yours? Claim │
└──────────────────────────────────────────────────────────────────────────────────────────┘
   after click →  ┌ Making berlinpackaging.com agent-ready  [Sitemap + JSON-LD] (● Live) ┐
                  │   27  products normalized · 31 pages · 0 failed   ▰▰▰▰▰▰▰▱▱▱ 27/40    │
                  │ Detect ✓  Discover ✓  Extract ◌  Publish ·  Grade ·                  │
                  │ [D] ──▶ [··] grading…                                                │
                  └──────────────────────────────────────────────────────────────────────┘
```

### 7.3 Store page `/stores/{slug}` (and `/stores`)

**Files:**
- `(site)/stores/[slug]/page.tsx` (server), `loading.tsx`, `not-found.tsx`;
- `components/store/*`. Client leaves: `GradeHero` (for the animation), `ConnectAgent`, `CopyButton`, `RescanButton`.

**Data:** `view = await getStoreView(slug, sp.from_scan)`. If it is null → `notFound()`.

**Sections:**

1. **StoreHeader + GradeHero:**
   - Header: name (fallback: domain), domain ↗, platform chip, "via {best_method label}" chip (from the scan), `product_count` products, "Indexed {ago}", and "✓ Verified merchant" if `store.claimed`, otherwise "Is this your store? Claim it →".
   - **GradeHero** (client) animates `from = scan.grade/score` → `to = store.readiness.after.grade/score` when `from_scan` is present:
     - 400 ms delay;
     - then the `GradeTile` flips (`key` change) from the D tile to the A tile, and the score counts up;
     - the caption changes from "Before: reachable only via web scraping" to "Now: API via ShoperZero · ≈1 s · $0.00 per task".
   - Without `from_scan`, it renders the static before → after pair.
   - `RescanButton`: `POST /api/v1/scans {url: store.base_url}` → `/scan/{scan_id}`.
2. **AgentSurfaces:** a table with a `GET`/`POST` badge, a label, the mono absolute URL, "Open ↗" and copy.

   | Label | URL | Note |
   |---|---|---|
   | products.json | `urls.products_json` | Shopify-compatible |
   | llms.txt | `urls.llms_txt` | agent instructions |
   | UCP profile | `urls.ucp` | UCP 2026-08-25 |
   | ACP feed | `urls.feed` | JSONL per variant |
   | MCP endpoint | `urls.mcp` | `POST`; tools `search_catalog`, `get_product`, `create_checkout`, `complete_checkout`, `scan_store`, `get_scan` … |
   | Checkout | text only | `woo_store_api` → "Native agent checkout (WooCommerce Store API)"; `handoff` → "Handoff: agent gets a prefilled-cart link" |

   Also include a copyable curl: `curl -s {products_json}?limit=1 | jq '.products[0] | {id,title}'`.
3. **ConnectAgent** (`id="connect"`), with tabs:
   - **Claude Desktop:** "Settings → Connectors → Add custom connector". ShoperZero → `{A}/api/mcp`; ShoperZero Demo Wallet → `{A}/api/demo-wallet/mcp` (test mode, buyer side). **UNVERIFIED** menu path and plan requirement.
   - **Config file:** `claude_desktop_config.json` using `npx -y mcp-remote <url>` for both servers (**UNVERIFIED** bridge package).
   - **Claude Code:** `claude mcp add --transport http shoperzero {A}/api/mcp` and `claude mcp add --transport http shoperzero-wallet {A}/api/demo-wallet/mcp` (**UNVERIFIED** flags).
   - **Cursor/other:** `{"mcpServers":{"shoperzero":{"url":"{A}/api/mcp"}}}`.
   - **Try this prompt** (copyable): "Using ShoperZero, find me a hoodie under $50 across the stores you can see and buy it in size M. Ship to Ada Lovelace, 1 Demo St, San Francisco, CA 94105, US, ada@example.com. Pay with the ShoperZero demo wallet."
4. **ProductGrid:** at most 48 `ProductCard`s. Each shows a plain `<img loading="lazy" referrerPolicy="no-referrer">` (or a gradient letter tile when there is no image), title, brand, `formatRange`, an availability dot, the variant count, a source chip, and the links "Store page ↗" and "JSON". After the grid: "+{total-48} more in products.json ↗".

**States:**

| Condition | Rendering |
|---|---|
| `loading.tsx` | Skeletons |
| Not found | "No store called {slug}. Scan it →" (links to `/`) |
| `crawling` | Banner "Indexing now…" linking `/scan/{latest_scan_id}?run={latest_crawl_run.id}`. If the ids are unavailable, link `/`. |
| `blocked` | Warn card: "This store challenged our crawler. We don't bypass bot protection. The merchant can claim it to opt in." |
| `failed` | Re-scan |
| `opted_out` | "The merchant opted this store out." Hide surfaces, connect and products. |
| Indexed with 0 products | `EmptyState` |

`/stores` shows `MetricsStrip`, then a table built from `listStores` (`StoreSummary`): `grade_before → grade_after`, name/domain, platform, best method (if present), products, checkout connector, verified, updated. Empty: "No stores yet. Scan one."

```
┌ ← Stores / berlinpackaging-com ───────────────────────────────────────────────────┐
│ Berlin Packaging  berlinpackaging.com ↗ [BigCommerce] [via Web scraping] 40 products│
│ ┌───┐        ┌───┐   Now: API via ShoperZero · ≈1 s · $0.00 per task   [↻ Re-scan] │
│ │ D │  ──▶   │ A │   Before: reachable only via web scraping (≈8 s · $0.01)        │
│ └───┘ 48     └───┘ 96                               Is this your store? Claim it → │
├ AGENT SURFACES ────────────────────────────────────────────────────────────────────┤
│ GET  products.json   https://app/s/berlinpackaging-com/products.json      Open↗ ⧉  │
│ GET  llms.txt · UCP profile · ACP feed …                                            │
│ POST MCP endpoint    https://app/api/mcp                                        ⧉  │
│      Checkout: Handoff: agent gets a prefilled-cart link                           │
├ CONNECT TO CLAUDE ──── [Claude Desktop] [Config file] [Claude Code] [Cursor] ───────┤
├ PRODUCTS ───────────── ┌────┐ ┌────┐ ┌────┐ ┌────┐ … ───────────────────────────────┤
└────────────────────────────────────────────────────────────────────────────────────┘
```

### 7.4 Checkout timeline `/checkouts/{id}` and `/checkouts/live`

**Files:** the two pages (server), plus `components/checkout/*` (client).

**Data:**
- `[id]`: `getCheckoutView(id)`. If both the checkout and the events are empty → `notFound()`.
- `live`: `?replay=spt|handoff|<recorded>` → fixture. Otherwise `getLatestCheckoutId()`, then `mode="follow"`.
- Empty follow state: "Waiting for an agent to start a checkout…" with a pulsing dot. The first INSERT attaches.

**Layout:** three columns on `lg` (rail | events | summary), stacked on mobile.

**Header:**
- "Checkout {shortId}" · store domain · connector chip (`woo_store_api` → "WooCommerce Store API", `handoff` → "Handoff");
- the UCP status chip (`STATE_TO_STATUS[state]`) and the internal `state` in mono;
- `LivePill` while not terminal;
- in follow mode, "Following latest · permalink ↗". Use the `links` entry with `type === "timeline"` from `checkout.links` when present.

**StateRail:** the happy path is `quoting → awaiting_payment → payment_authorized → placing_order → order_placed → completed`, with the labels "Quote from merchant", "Ready for payment", "Payment authorized", "Placing order on merchant", "Order placed", "Captured and complete".

| State | Rendering |
|---|---|
| Reached | ✓, good |
| Current | accent + shimmer |
| Future | muted |
| `requires_action` | amber side branch |
| `handoff` | amber terminal node "Handed off to merchant checkout" |
| `refunding` / `failed` / `expired` / `canceled` | red terminal node |

**EventRow:**
- `+{s}s` since the first event;
- `from_state → to_state` chips;
- `message`;

| Key | Rendering |
|---|---|
| `payment_intent_id` | "PaymentIntent pi_… ↗" + copy |
| `merchant_order_url` / `merchant_order_id` | "WooCommerce order #… ↗" |
| `continue_url` | "Open prefilled cart ↗" |
| `rail` | rail chip |
| `amount` | money |
| `simulated` | "simulated" chip |
| `error_code` | bad chip |

**CheckoutSummary:**
- line items, totals, the selected shipping option and the payment handlers;
- an **Order card** when `checkout.order` exists: merchant order id, Woo admin link, Stripe payment reference;
- a **Handoff card** when `continue_url` exists and the status is `requires_escalation`: "Continue on merchant site ↗", with the copy "This store has no agent checkout API. We hand off honestly with a prefilled cart."

**PII rule:** never render `buyer.email`, `buyer.phone`, `address.line1` or `address.line2`. Show only the name's initials and `city, country`.

**States:**
- summary unavailable (`getCheckout` threw) → "Checkout details unavailable. Showing event log.";
- `completed` → good banner "Agent checkout complete · {total} · {rail}";
- failure → bad banner with `messages[0].content`.

```
┌ Checkout 3f9a1c2e · demo-woo.example.com · [WooCommerce Store API] (completed) completed ┐
├ ✓ Quote from merchant  │ +0.0s  → quoting   Cart created on WooCommerce Store API │ 1 × Hoodie (M) $42.00│
│ ✓ Ready for payment    │ +1.2s  quoting → awaiting_payment  Quote $47.00 frozen   │ Shipping        $5.00│
│ ✓ Payment authorized   │ +9.8s  → payment_authorized [Stripe SPT] pi_3Q… ↗ ⧉      │ Total          $47.00│
│ ✓ Placing order        │ +11.0s → placing_order                                    │ Ship to A.L. · SF, US│
│ ✓ Order placed         │ +12.4s → order_placed  WooCommerce order #1042 ↗          │ ┌ Order #1042 ─────┐ │
│ ✓ Captured, complete   │ +12.9s → completed                                        │ │ Open in Woo ↗    │ │
└────────────────────────┴───────────────────────────────────────────────────────────┴──────────────────────┘
```

### 7.5 Claim `/claim/{slug}` + `POST /api/v1/claims` (B3)

**Files:** `(site)/claim/[slug]/page.tsx` (server: `getStoreBySlug(slug)` or `notFound()`), `components/claim/ClaimFlow.tsx`, `api/v1/claims/route.ts`, `api/v1/claims/_verify.ts`.

**Model (spec 00 / 01, B3):**
- One `store_claims` row per store (`store_id` PK, `method`, `token`, `verified_at`), **service-role only**.
- `stores.claimed_at` is set by `markClaimVerified`, and `Store.claimed` is derived from it.
- `stores.opted_out` is set via `setStoreOptOut`.
- WS5 never touches tables directly; it only calls these helpers.

**Token handling:**
- `upsertClaim` **rotates** the token and resets `verified_at`, so call it **only when `getClaim` returns null**, or on an explicit `action: "rotate"`. That keeps the token stable for DNS pre-staging.
- The published strings follow the `StoreClaim` comment in spec 00:
  - TXT value `shoperzero-verify=<token>`;
  - meta tag `<meta name="shoperzero-verify" content="<token>">`.
- The TXT host convention is `_shoperzero.<host>`, with the apex also accepted (§12 R2-8).
- The token only proves anything when it appears on the claimant's DNS or HTML. Returning it to any caller of `start` is safe, and the store row stays free of it (B3).

#### API contract

`POST /api/v1/claims`, JSON body, parsed with zod v4 via `parseJsonBody`. Wrap the handler in WS1's `route("claims", …)`, export `OPTIONS = preflight`, and respond with `json()` (CORS headers included). Errors use `errorResponse()` → `{error:{code,message,details?}}` (B11).

```ts
type ClaimRequest =
  | { slug: string; action: "start"; method?: ClaimMethod }         // method only used when creating
  | { slug: string; action: "rotate"; method: ClaimMethod }         // explicit new token (unverifies)
  | { slug: string; action: "verify"; method: ClaimMethod }
  | { slug: string; action: "opt_out" | "opt_in"; method: ClaimMethod };  // re-verifies first

type ClaimView = {
  slug: string; domain: string;
  status: "pending" | "verified";            // verified_at != null
  token: string;
  method: ClaimMethod;                       // store_claims.method (as created)
  verified_at: string | null;
  opted_out: boolean;
  instructions: {
    dns_txt: { host: string; alt_hosts: string[]; value: string };  // "_shoperzero.<host>", ["<host>", …], "shoperzero-verify=<token>"
    meta_tag: { url: string; html: string };                        // "https://<host>/", '<meta name="shoperzero-verify" content="<token>">'
  };
};
type CheckResult = { method: ClaimMethod; ok: boolean; observed: string[]; hint?: string };
```

| Action | Success | Failure |
|---|---|---|
| `start` | 200 `{ claim }` (idempotent; never rotates) | 404 `not_found` (unknown slug) |
| `rotate` | 200 `{ claim }` | — |
| `verify` | 200 `{ claim, check }`. `check.ok:false` is **not** an HTTP error | — |
| `opt_out` / `opt_in` | 200 `{ claim, check }` after a successful re-verify | 403 `forbidden` `{ details: { check } }` when the re-verify fails |
| any | — | 400 `validation_error` (bad body) · 404 `not_found` (unknown slug, or `verify` before `start`) · 500 `internal` |

#### Logic

1. Parse the body, then `store = await getStoreBySlug(slug)`. If it is missing → `AppError("not_found")`.
2. `host = new URL(store.base_url).hostname`. **Only the stored host is ever contacted, never user input** (SSRF guard).
3. `start`: `claim = await getClaim(store.id) ?? await upsertClaim(store.id, method ?? "dns_txt")`. Return the view.
4. `rotate`: `upsertClaim(store.id, method)`. Return the view.
5. `verify`:
   - `claim = await getClaim(store.id)`. If it is missing → `not_found` with the message "Start the claim first".
   - Run `checkDns(host, claim.token)` or `checkMeta(host, claim.token)`. Either method verifies the same token, whatever `claim.method` was at creation.
   - On `ok`: `await markClaimVerified(store.id)`, then re-read the claim and return `status: "verified"`.
6. `opt_out`/`opt_in`: the same check. On failure → 403 `forbidden`. On success → `markClaimVerified` (if not yet verified), then `setStoreOptOut(store.id, action === "opt_out")`.

`_verify.ts`:

```ts
import "server-only";
import { Resolver } from "node:dns/promises";
import * as cheerio from "cheerio";

const PREFIX = "shoperzero-verify=";
const META = "shoperzero-verify";

export function dnsHosts(host: string): string[] {
  const bare = host.startsWith("www.") ? host.slice(4) : null;
  return [`_shoperzero.${host}`, host, ...(bare ? [`_shoperzero.${bare}`, bare] : [])];
}

export async function checkDns(host: string, token: string) {
  const r = new Resolver({ timeout: 3000, tries: 2 });
  r.setServers(["1.1.1.1", "8.8.8.8"]);                  // public resolvers see new records sooner
  const observed: string[] = [];
  for (const h of dnsHosts(host)) {
    try {
      for (const chunks of await r.resolveTxt(h)) {       // string[][]: join the chunks of one record
        const v = chunks.join("");
        if (v.startsWith(PREFIX)) observed.push(`${h}: ${v}`);
        if (v === PREFIX + token) return { method: "dns_txt", ok: true, observed } as const;
      }
    } catch { /* ENOTFOUND / ENODATA / timeout: try the next host */ }
  }
  return { method: "dns_txt", ok: false, observed,
    hint: `Add a TXT record at _shoperzero.${host} with value ${PREFIX}${token}. DNS can take a few minutes.` } as const;
}

export async function checkMeta(host: string, token: string) {
  const res = await fetch(`https://${host}/`, {
    redirect: "follow", signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": crawlerUA(), Accept: "text/html" },   // flags.crawlerUserAgent() from @/shared/env
  }).catch(() => null);
  if (!res?.ok) return { method: "meta_tag", ok: false, observed: [],
    hint: `Couldn't fetch https://${host}/ (${res?.status ?? "network error"}).` } as const;
  const $ = cheerio.load((await res.text()).slice(0, 512_000));
  const observed = $(`meta[name="${META}"]`).map((_, el) => $(el).attr("content") ?? "").get();
  return observed.includes(token)
    ? { method: "meta_tag", ok: true, observed } as const
    : { method: "meta_tag", ok: false, observed,
        hint: `Add <meta name="${META}" content="${token}"> inside <head> of https://${host}/.` } as const;
}
```

If cheerio is unavailable, fall back to the regex `/<meta[^>]+name=["']shoperzero-verify["'][^>]*content=["']([^"']+)["']/gi` (it assumes `name` comes before `content`).

In `UI_MOCK`, the route returns fixture views and `verify` succeeds for tokens starting with `mock`.

#### ClaimFlow (client)

1. On mount, send `start`. Show a skeleton until it returns. On error, show `ErrorState` with Retry.
2. **Pending:** two method cards.
   - DNS TXT: Host + Value, each with a copy button, the note "Apex {host} also works", and **Verify DNS**.
   - Meta tag: the snippet with copy, "Paste inside `<head>` of https://{host}/", and **Verify meta tag**.
   - On `ok:false`, show the `hint` and either "We found: …" or "No record found yet".
   - A small link "Generate a new token" sends `rotate` after a confirm in the native `<dialog>`.
3. **Verified:** "✓ Verified merchant · {domain} · claimed {ago} via {method}", links to the store page and the surfaces, an **Opt out of the index** toggle (with a confirm dialog; sends `opt_out`/`opt_in`), and a clearly labeled "Coming soon" list: field overrides, live-price webhook, native checkout (plugin / Stripe Connect), serving `/.well-known/ucp` from your own domain.
4. **Opted out:** "Opted out. Agents no longer see this store." with **Opt back in**.

```
┌ Claim Berlin Packaging (berlinpackaging.com) ────────────────────────────────────┐
│ Prove you control this domain: verified badge, opt-out control, and (soon) native│
│ checkout and your own /.well-known/ucp.                                          │
├ Option A · DNS TXT ──────────────────────┬ Option B · Meta tag ───────────────────┤
│ Host  _shoperzero.berlinpackaging.com  ⧉ │ <meta name="shoperzero-verify"        │
│ Value shoperzero-verify=9f2c…          ⧉ │  content="9f2c…">                   ⧉ │
│ [Verify DNS]   ✗ No record yet.          │ [Verify meta tag]                     │
└──────────────────────────────────────────┴───────────────────────────────────────┘
```

### 7.6 Metrics strip

**Files:** `_lib/metrics.ts` (server-only), `components/metrics/MetricsStrip.tsx` (server), `AutoRefresh.tsx` (client; calls `router.refresh()` every 10 s, used on `/` and `/stores` only).

```ts
export type UiMetrics = PublicMetrics & {
  median_seconds_to_ready: number | null;                     // last 50 succeeded crawl_runs: median(finished_at - created_at)
  stores_by_best_method: Partial<Record<AccessMethod | "none", number>>;  // stores.best_method
  orders_by_rail: Partial<Record<PaymentRailId, number>>;     // orders.rail
};
export async function getUiMetrics(): Promise<UiMetrics | null>
  // await connection(); UI_MOCK → MOCK_METRICS; base = await getPublicMetrics();
  // extras via WS1's service-role db() client (aggregates only, never rows to the client); any error → null
```

| Tile | Value | Sub-line |
|---|---|---|
| **Stores scanned** | `stores_total` | a stacked bar by `stores_by_best_method` (api good, dom warn, computer_use serious, none bad) with a legend "API · DOM · Computer use · None" |
| **Products normalized** | `products` | — |
| **Time to agent-ready** | `median_seconds_to_ready` as `m:ss` | "median, CTA → live products.json" |
| **Agent checkouts** | `orders` | "Stripe test {n}" |
| *(optional)* | `agent_requests_24h` | "agent queries (24 h)" |

§12 R2-9 asks WS1 to fold the extras into `getPublicMetrics`. The fallback is computing them here.

### 7.7 `/bot` (B16)

**File:** `(site)/bot/page.tsx`, a static server page with no data calls. It uses `appUrl()` for examples, and no `connection()`, so it is prerendered.

Content, as short sections:
- **What ShoperZeroBot is:** the user agent string is `flags.crawlerUserAgent()` (for example `ShoperZeroBot/0.1 (+{APP}/bot)`). It indexes public product pages so AI agents can find and buy products through standard protocols (UCP, MCP, products.json).
- **What it does:**
  - fetches public, logged-out pages only;
  - calls platform APIs first, then sitemaps and JSON-LD;
  - the **discovery scan** may drive a real browser (computer use) through home → product → cart → checkout page, and **always stops before payment**;
  - images are linked, never re-hosted.
- **What it respects:**
  - robots.txt `Disallow` and `Crawl-delay`;
  - `Content-Signal`;
  - `X-Robots-Tag: noindex/noai`;
  - 1–2 requests per second per host;
  - it never solves CAPTCHAs or bypasses bot protection. Challenged stores are marked "blocked".
- **How to opt out:**
  - (1) `robots.txt`:
    ```
    User-agent: ShoperZeroBot
    Disallow: /
    ```
  - (2) claim your store at `/claim/{slug}` and toggle "Opt out", which takes effect immediately;
  - (3) contact email (placeholder `bot@<domain>`, set before the demo).
- **How to opt in or claim:** a link to `/claim`, via search at `/stores`.

---

## 8. Visual direction

### 8.1 Concept: "the wire"

ShoperZero sits between a store and an agent, so the UI reads like an instrument panel for that connection:
- warm paper neutrals and ink;
- **one** electric accent for live activity;
- strict status colors (good, warn, serious, bad) used only for state;
- mono type for anything an agent consumes (URLs, selectors, ids, counters), sans for text a human reads.

The two signature moments are the **cascade** (cards lighting up left to right, the computer-use frame streaming screenshots) and the **grade flip D → A**. The visual language comes from `demos/prototypes/original/index.html`: cards, pills, the shimmer rail, the live pill, the score ring and the hero beam. The earlier mock and the product therefore look like one system.

### 8.2 Typography

- **Geist Sans** for UI and **Geist Mono** for agent-facing text and numbers. Both are already loaded in `layout.tsx`.
- **Instrument Serif italic** for one display accent (the landing H1 phrase and the verified badge): `Instrument_Serif({ subsets:["latin"], weight:"400", style:["italic"], variable:"--font-instrument" })`. **UNVERIFIED** export name. Fallback: Geist 650 italic.
- Sizes:

  | Element | Size |
  |---|---|
  | H1 | `clamp(40px,6vw,72px)` / 1.02 / `-0.045em` / 650 |
  | H2 | 28–30 px |
  | Body | 15/1.5 |
  | Eyebrows | 11.5 px uppercase `.08em` muted |
  | Counters | Geist Mono 56 px `tabular-nums` |
  | Score ring number | 50 px |

- Remove the scaffold's `font-family: Arial` on `body`; it overrides Geist.

### 8.3 Tokens: `src/app/globals.css` (replace the file)

```css
@import "tailwindcss";

:root {
  color-scheme: light;
  --page: #f7f6f2;  --surface: #fdfcf9;  --well: #efede7;
  --ink: #0c0c0b;   --ink-2: #4f4e4a;    --muted: #8a8880;
  --line: rgb(12 12 11 / 0.09);          --grid: #e2e0d8;
  --accent: #2f6bff; --accent-ink: #ffffff;
  --good: #11a34a; --good-2: #7cb518; --warn: #f5a524; --serious: #ec835a; --bad: #e5484d;
  --code-bg: #141413; --code-ink: #e9e8e2;
  --shadow: 0 1px 2px rgb(12 12 11 / .04), 0 18px 40px -22px rgb(12 12 11 / .18);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --page: #0b0b0a; --surface: #161614; --well: #1f1f1c;
    --ink: #f4f3ee;  --ink-2: #c3c2b7;   --muted: #8a8880;
    --line: rgb(255 255 255 / 0.09);     --grid: #2c2c2a;
    --accent: #5b8cff; --code-bg: #0b0b0a;
    --shadow: 0 1px 2px rgb(0 0 0 / .3), 0 18px 40px -22px rgb(0 0 0 / .7);
  }
}
:root[data-theme="dark"] { /* same values as the dark block above: copy them */ }

@theme inline {
  --color-page: var(--page);    --color-surface: var(--surface); --color-well: var(--well);
  --color-ink: var(--ink);      --color-ink-2: var(--ink-2);     --color-muted: var(--muted);
  --color-line: var(--line);    --color-grid: var(--grid);
  --color-accent: var(--accent); --color-accent-ink: var(--accent-ink);
  --color-good: var(--good); --color-good-2: var(--good-2); --color-warn: var(--warn);
  --color-serious: var(--serious); --color-bad: var(--bad);
  --color-code: var(--code-bg); --color-code-ink: var(--code-ink);
  --font-sans: var(--font-geist-sans), system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, monospace;
  --font-display: var(--font-instrument), Georgia, serif;   /* next/font var is --font-instrument (avoids a self-reference) */
  --radius-card: 18px;
  --shadow-card: var(--shadow);
  --animate-shimmer: shimmer 1.2s linear infinite;
  --animate-pulse-dot: pulse-dot 1.3s ease-in-out infinite;
  --animate-flip-in: flip-in 600ms cubic-bezier(.2,.7,.2,1) both;
  --animate-rise: rise 350ms ease both;
  --animate-fade: fade 200ms ease both;
}

@keyframes shimmer   { from { background-position: 100% 0 } to { background-position: -150% 0 } }
@keyframes pulse-dot { 50% { opacity: .35 } }
@keyframes flip-in   { from { transform: perspective(400px) rotateX(90deg); opacity: 0 } }
@keyframes rise      { from { transform: translateY(4px); opacity: 0 } }
@keyframes fade      { from { opacity: 0 } }

body { background: var(--page); color: var(--ink); font-family: var(--font-sans); }
.shimmer-bar {
  background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 25%, transparent) 0 30%, var(--accent) 50%,
              color-mix(in srgb, var(--accent) 25%, transparent) 70% 100%);
  background-size: 250% 100%;
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
```

- Use the token utilities: `bg-page`, `bg-surface`, `bg-well`, `text-ink`, `text-ink-2`, `text-muted`, `border-line`, `bg-accent`, `text-good`, `rounded-card`, `shadow-card`, `font-mono`, `animate-shimmer`.
- **No `dark:` variants.** The tokens flip on their own. Keep the `color-mix` tint classes inside `Chip`, `GradeTile` and `MethodCard` so they appear only once.
- **Dark mode** follows the OS. Put the demo laptop in dark mode.
- **ThemeToggle (stretch):** set `data-theme` and `localStorage["sz-theme"]`, bootstrap it with an inline script, and add `suppressHydrationWarning` on `<html>` (see `02-guides/preventing-flash-before-hydration.md`).

### 8.4 Component motifs

| Component | Look |
|---|---|
| **Card** | `bg-surface border border-line rounded-card shadow-card`; header `px-6 pt-5 pb-3` |
| **MethodCard** | Card + a 3 px top strip in the status tone. `running` gets a shimmer strip, and the best method gets `ring-2 ring-accent`. `skipped` collapses to one 44 px row in muted |
| **Chip** | pill, 12.5 px/560, background is the tone at 13%, with a 16 px `StatusDot` |
| **GradeTile** | sizes sm 36 / md 64 / xl 96 px, rounded square. The letter is Geist 700; background is the tone at 14% with a 1.5 px tone border. `key={grade}` retriggers `animate-flip-in` |
| **ScoreRing** | SVG ring (as in the mock's `.ring`): track is the tone at 16%, the fill stroke animates on mount, number in the center |
| **LivePill** | red tint, 7 px dot `animate-pulse-dot`, "Live" |
| **ComputerUseViewer** | `bg-well rounded-xl` frame, a 28 px chrome bar with three 8 px dots, the image `object-contain`, `animate-fade` per new `src` (`key={src}`) |
| **CountUp** | 700 ms rAF tween, `tabular-nums`; reduced motion jumps straight to the value |
| **CodeBlock** | `bg-code text-code-ink rounded-xl p-4 font-mono text-[12.5px]` plus a copy button |
| **CopyButton** | `navigator.clipboard.writeText`; the icon becomes a check for 1.5 s; `aria-label="Copy"` |
| **Comparison bars** | log-scale width: `Math.max(4, 100 * Math.log10(1 + v) / Math.log10(1 + max))` % |
| **Hero beam** | landing only, optional: the conic sweep from `demos/prototypes/original/index.html` `.beam` |
| **Icons** | 12 inline SVGs in `ui/icons.tsx`: arrow-right, external, copy, check, x, refresh, bolt, lock, store, globe, cursor, code |

### 8.5 Layout

- Content width `max-w-[1240px] mx-auto px-5 md:px-7`.
- Sticky TopBar with `backdrop-blur`.
- Mobile first: the cascade and the checkout columns stack below `lg`.
- Projector legibility: no text under 12 px, and body text at a contrast of at least 4.5:1.

### 8.6 Packages

None.
- CSS keyframes, so no motion library.
- Inline SVG, so no icon package.
- A 30-line tabs component.
- `<pre>`, so no syntax highlighter.
- Flex divs, so no chart library.
- Native `<dialog>` for the opt-out confirm and screenshot zoom.

This keeps the build within about 2 hours and avoids `package-lock.json` conflicts.

---

## 9. Mock mode and replay

### 9.1 Mechanisms

1. **`NEXT_PUBLIC_UI_MOCK=1`: everything from fixtures, with no Supabase at all.**
   - `_lib` returns fixtures.
   - `ScanForm` routes to `/scan/replay-dom?demo=1`.
   - The CTA plays the indexing frames, then routes to `/stores/{fixture slug}?from_scan=replay-dom`.
   - `/checkouts/live` defaults to `?replay=spt`.
   - The claims route returns fixture views.
2. **Replay routes work in every mode**, and double as the on-stage safety net:
   - `/scan/replay-api`, `/scan/replay-dom`, `/scan/replay-cu`, `/scan/replay-none`, `/scan/replay-<recorded id>`;
   - `/checkouts/live?replay=spt|handoff|<recorded>`.
   - Replays are **always labeled** "Replay · recorded {date}" in place of the LivePill.
   - Outside mock mode, a replay's CTA plays the recorded indexing frames and ends on a "Replay complete" card. It links to the real `/stores/{slug}` if `getStoreBySlug(fixture.store.slug)` exists, and otherwise stays on the card.

### 9.2 Fixtures (`mock/fixtures/`, TypeScript typed with `@/contracts`)

`tsconfig` includes `**/*.ts`, so the fixtures type-check. Import them relatively from `src/app/(site)/_lib/mock.ts` (for example `../../../../mock/fixtures`). Server pages pass fixture data to client components as props.

```ts
export type ScanReplayFrame = { at_ms: number; scan: Partial<ScanReport> };   // probes are replaced wholesale per frame
export type ScanReplay = {
  id: string; recorded_at: string;
  final: ScanReport;                       // the end state
  frames: ScanReplayFrame[];               // built by buildCascadeFrames(final)
  indexing: { run: CrawlRun; store: Store; frames: { at_ms: number; run?: Partial<CrawlRun>; store?: Partial<Store> }[] };
  store: Store;                            // for the store page in mock mode
};
```

| File | Contents |
|---|---|
| `stores.ts` | `MOCK_STORES: Store[]`: `shoperzero-demo` (woocommerce, `woo_store_api`), `berlinpackaging-com` (bigcommerce, `handoff`), `hester-demo-squarespace-com` (squarespace), `meridian-athletic-example` (custom, computer use only), `lockedshop-example` (blocked). Each has a `readiness.after` of A where applicable. |
| `products.ts` | 8 products per indexed store. The Woo store has "Hoodie" ($42, S/M/L), "Hoodie with Logo" ($45), "Beanie" ($18) and so on, with `images: []` so the placeholder tiles render offline. |
| `scans.ts` | **One `ScanReport` per `best_method`** (below). |
| `shots.ts` | `mockShot(title: string, lines: string[], highlight?: string): string` returns a `data:image/svg+xml;utf8,…` URI of a 1280×800 wireframe page (header bar, title, gray blocks, and a highlighted rectangle labeled `highlight`). Offline, with no image files. |
| `cascade.ts` | `buildCascadeFrames(final: ScanReport, pace = 1): ScanReplayFrame[]` (algorithm below) |
| `crawl-scripts.ts` | indexing frames per store (round-1 scripts, 10–25 s) |
| `checkout-scripts.ts` | `spt`, `handoff`: a `CheckoutSession` + `{at_ms, event, checkout?}` frames, using the CCR-5 `data` keys |
| `metrics.ts` | `MOCK_METRICS: UiMetrics` (9 stores: api 4, dom 3, computer_use 1, none 1; 1,042 products; 38 s; 3 orders) |
| `claims.ts` | a `ClaimView` for `berlinpackaging-com` with token `mock9f2c…` |

**`scans.ts`: the four `ScanReport` fixtures.** Scores are illustrative; WS2 owns the real weights.

| Id | Store | `best_method` | probes (status) | score/grade | `after` | Notes |
|---|---|---|---|---|---|---|
| `replay-api` | shoperzero-demo | `api` | api `passed`; dom `skipped`; computer_use `skipped` | 78 / B | 96 / A | api signals: "Woo Store API 200 · 24 products", "products.json 404", "/.well-known/ucp 404", "MCP none". endpoints: `…/wp-json/wc/store/v1/products`. est 1 s / $0.00. Capabilities all true except `checkout_reachable: true` via the Store API. Recommendations: publish UCP + MCP. |
| `replay-dom` | berlinpackaging-com | `dom` | api `failed` (4 ✗ signals); dom `passed`; computer_use `skipped` | 48 / D | 96 / A | dom signals: robots OK, sitemap 1,204 URLs, JSON-LD 3/3, "Add-to-cart located", "Variant picker not found". Recipe: `product_card: "li.product"`, `title: "h1.productView-title"`, `price: ".price--main"`, `add_to_cart: "#form-action-addToCart"`, `cart_link: "a.navUser-action--cart"`, `checkout_link: "a[href='/checkout']"`. est 8 s / $0.01; `variants: false`. **This is the demo fixture.** |
| `replay-cu` | meridian-athletic-example | `computer_use` | api `failed`; dom `failed` ("Price rendered by JavaScript only", "No JSON-LD Offer"); computer_use `passed` | 22 / F | null | 9 `steps` with `screenshot: mockShot(...)`: (1) `goto("/")` "Homepage"; (2) `click("Shop")`; (3) `click("Trail Runner")` product page; (4) `read price $128.00`; (5) `select("Size 9")`; (6) `click("Add to cart")`; (7) `click("Cart")`; (8) `click("Checkout")`; (9) "Checkout page reached: stopping before payment". Screenshots list the same 9 URIs. est 94 s / $0.31. Recommendation: "Add Product JSON-LD with Offer", "Claim to connect a feed". |
| `replay-none` | lockedshop-example | `none` | api `blocked`; dom `blocked`; computer_use `blocked` ("Bot challenge (403) on homepage") | 0 / F | null | Recommendation: "Allow verified agents (Web Bot Auth) or claim the store." |

**`buildCascadeFrames` algorithm** (it emulates WS2's incremental writes; about 12–25 s total depending on the fixture):
1. `t = 0`: `status: "running"`, every probe `pending` with empty signals.
2. For each probe in `METHOD_ORDER` that is not `skipped` in `final`:
   - emit `running` with `started_at`;
   - reveal its `signals` one at a time every `700 ms × pace`;
   - for `computer_use`, reveal one `steps[i]` and `screenshots[i]` per frame every `2500 ms × pace`;
   - emit its final probe (status, capabilities, estimates, recipe/endpoints).
3. Emit the skipped probes as `skipped`.
4. Emit `status: "done"` with `score`, `grade`, `checks`, `after`, `recommendations` and `best_method`.

### 9.3 Recording real runs (after the first good rehearsal)

Every Realtime payload of a scan is a complete snapshot. During a rehearsal, run a throwaway snippet in the browser console on `/scan/{id}` that pushes `{at_ms, scan: payload.new}` into `window.__frames`. Paste the result into `mock/recorded/<id>.json` as a `ScanReplay`, using `final` = the last frame.

Pure-SQL alternative, keeping the synthetic frames:

```sql
select to_jsonb(s) from scans s where id = '<scan id>';
select to_jsonb(r) from crawl_runs r where id = '<run id>';
select json_agg(e order by e.id) from checkout_events e where checkout_id = '<checkout id>';
```

The computer-use screenshots in a recorded run are Supabase Storage public URLs, so they only work online. Keep `replay-cu` (offline SVGs) as the offline fallback.

### 9.4 `mock/seed-ui.sql` (optional, local only)

Against WS1's seed store, it inserts:
- one `scans` row copied from the `replay-dom` fixture;
- one succeeded `crawl_runs` row with a log;
- `stores.readiness`;
- one `checkouts` row with 6 `checkout_events` and an `orders` row.

Run it with Studio's SQL editor, or with `psql "<local DB URL from supabase status>" -f mock/seed-ui.sql`.

---

## 10. Demo material (`docs/demo/`)

Create `runbook.md` (§10.1 + §10.3 + §10.4), `script.md` (§10.2) and `qa.md` (§10.5).

### 10.1 Pre-demo checklist

**Infra (T-60)**
- [ ] Prod is deployed at a public HTTPS URL (Vercel). All env vars are set, including `ANTHROPIC_API_KEY`, `SCAN_CU_ENABLED=1`, `SCAN_CU_MAX_STEPS=15` and Browserbase keys (if used). `NEXT_PUBLIC_UI_MOCK` must be **unset**.
- [ ] **Tunnel up** for the Woo demo store (`cloudflared`, a named tunnel). `WOO_DEMO_URL` must equal the WordPress `siteurl`/`home`. Check: `curl -sI $WOO_DEMO_URL/wp-json/wc/store/v1/products | head -1` → `200`.
- [ ] Fallback app host: `npm run build && npm start` locally plus a second tunnel, with `APP_URL` set to it and the Claude connectors re-added.

**Pick the live scan target (T-60).** The story needs a **third-party store that lands in `dom` with a D/F grade** and can be indexed in under 30 s.
- [ ] Scan these candidates on prod and write down `best_method`, grade and duration:
  - `https://www.berlinpackaging.com` (BigCommerce: no public catalog API, JSON-LD LIVE-OK per research 04);
  - `https://www.camelbak.com`: likely `api` via SFCC, so a backup only;
  - any custom JSON-LD store found by WS2.
- [ ] Choose the first one that gives **`dom`, grade ≤ D, a scan under 20 s, and indexing of 40 products under 30 s**. Write it into `DEMO_PRESETS[0]`.
- [ ] Also keep one finished **computer-use** scan (a JS-only store, or `/scan/replay-cu`) open in a tab for the 10-second "worst case" beat.
- [ ] The live target must **not** be pre-indexed in the last 6 h. The CTA sends `force: true` anyway, but a fresh store makes the D→A jump honest.

**Data (T-45)**
- [ ] Pre-index the Woo demo store (`POST /api/v1/stores {url: WOO_DEMO_URL}`) and 4–6 other stores for the metrics: `hester-demo.squarespace.com`, `porterandyork.com`, `www.bulk.com/uk`, `www.camelbak.com`. Each must reach `indexed`. Drop any store that comes back `blocked`; never force it.
- [ ] `curl "$APP/api/v1/search?q=hoodie"` returns a Woo hoodie under $50 that is in stock. **UNVERIFIED** that the sample data has one; if not, create "Hoodie" at $42 in sizes S/M/L with stock management off.
- [ ] Claim staging (optional beat): open `/claim/{woo-slug}`, which creates the token, and publish it via DNS TXT on a domain we control, or via a mu-plugin in the Woo container: `wp-content/mu-plugins/sz-verify.php` → `<?php add_action('wp_head', fn() => print('<meta name="shoperzero-verify" content="TOKEN">'));`. Do not press Verify yet. Never press "Generate a new token" afterwards: it rotates the token.

**Payments (T-30)**
- [ ] The Stripe test mode SPT spike passes. If WS4 fell back, say "SPT-compatible PaymentIntent".

**Agent (T-20)**
- [ ] **Claude Desktop MCP configured:** "ShoperZero" → `{APP}/api/mcp` and "ShoperZero Demo Wallet" → `{APP}/api/demo-wallet/mcp`. Disable other connectors and web search.
- [ ] A full rehearsal, choosing **"Always allow"** on every tool (**UNVERIFIED** that it persists; if not, narrate over the prompts).
- [ ] Optional: a Claude Project with the instruction "Use ShoperZero tools to shop; pay by calling wallet_issue_spt with the checkout total and passing the token to complete_checkout."
- [ ] Fallback agent: WS4's `scripts/agent-*.ts`.

**Stage (T-10)**
- [ ] Dark mode, Do Not Disturb, 125% zoom, hotspot as backup network.
- [ ] Tabs, in order:
  1. `/` with the target URL typed in the input, not yet submitted;
  2. the finished computer-use report (`/scan/{cu id}` or `/scan/replay-cu`);
  3. `/checkouts/live`;
  4. Woo admin → Orders;
  5. Stripe test Payments;
  6. `/claim/{woo-slug}` (optional);
  7. the backup video, paused at 0:00.
- [ ] Claude Desktop: a new chat, with the prompt on the clipboard.

### 10.2 The 2-minute script (`docs/demo/script.md`)

| Time | Screen / exact action | Say (verbatim-ish) |
|---|---|---|
| **0:00** Hook | Tab 1 `/`. The URL of the target is already typed. Click **Scan**. | "Can an AI assistant shop this store? Let's ask it the way an agent would." |
| **0:05** Cascade | `/scan/{id}`. The API card turns red signal by signal (products.json 404, no UCP, no MCP, no platform API) → **Failed**. The DOM card lights up: sitemap, JSON-LD, then the recipe fills in (price, add-to-cart selectors) → **Works**. The computer-use card says "Not needed". | "First we look for an API: UCP, MCP, a products feed. Nothing. Next we read the page itself, the way a scraper would, and learn where the price is and where to click. That works, barely." |
| **0:25** Score | The report renders: **grade D**, "reachable only by scraping", comparison "API ≈1 s / $0.00 vs computer use ≈90 s / $0.30". Point at the bars. | "That's a D. Every agent task here takes about 8 seconds of scraping, and it breaks when the theme changes." |
| **0:35** Worst case | Tab 2: the computer-use report, with its screenshot filmstrip. Scrub two thumbnails. | "And this is the worst case: no structure at all, so an agent clicks through screenshots. 90 seconds and 30 cents per task. We stop before payment." |
| **0:45** Fix | Back on tab 1, click **Make it agent-ready**. The indexing lane appears: counter ticking, stages Detect → Discover → Extract → Publish → Grade. The grade tile flips **D → A**, then the page auto-opens the store page. | "One click. We index the catalog the way we just found, normalize it, and host what Shopify stores get for free: products.json, a UCP profile, an MCP server, an ACP feed, llms.txt. No plugin." |
| **1:05** Output | The store page with the grade animating to A. Click **products.json ↗** for one second and close it. Point at the MCP row and "Connect to Claude". | "Same shape as Shopify's, so existing agents just work. From a D to an A." |
| **1:10** Claude buys | Claude Desktop: paste *"Using ShoperZero, find me a hoodie under $50 across the stores you can see and buy it in size M. Ship to Ada Lovelace, 1 Demo St, San Francisco, CA 94105, US, ada@example.com. Pay with the ShoperZero demo wallet."* Press Enter, then tab 3 `/checkouts/live`. | "Now the payoff. Claude searches every store we've made agent-ready, finds a hoodie on our WooCommerce store, and calls `create_checkout`: a live quote from the store's own API. It pays us with a Stripe Shared Payment Token, authorized with manual capture. We place the order, then capture." Narrate the rows as they stream. |
| **1:40** Proof | The timeline shows **completed**. Click **WooCommerce order #… ↗** (tab 4), then **PaymentIntent ↗** (tab 5). | "A real order in the merchant's admin, a real test PaymentIntent in Stripe." |
| **1:50** Close | Tab 1 `/`: the metrics strip. | "Stores where the only way in was scraping or screenshots are now one API call away. {N} stores scanned, {k} agent checkouts. ShoperZero: UCP for the other 80% of the web." |

**Timing guards:**
- If the scan hasn't reached the report by 0:30, keep narrating. At 0:40, switch to `/scan/replay-dom` (labeled Replay) and say "a recording of the same scan from 20 minutes ago".
- If indexing hasn't finished by 1:00, click "Open agent surfaces" anyway. The store page works with partial products.
- If Claude hasn't reached `create_checkout` by 1:25, open the rehearsal's `/checkouts/{id}`.
- The claim beat is optional. Use it in Q&A: "the merchant proves the domain with one DNS record" (tab 6, **Verify DNS**).

**Honesty line, only if asked why Claude bought from the Woo store:** "Native checkout needs a store API; we own this WooCommerce store for the demo. On the store we just fixed, Claude would get an honest prefilled-cart handoff, and we never place orders on stores that haven't opted in."

### 10.3 Failure decision tree

| Symptom | Action (≤ 5 s) |
|---|---|
| The live scan lands in `api`, or is blocked | Say "this one's already in decent shape". Open `/scan/replay-dom` (labeled Replay), or the second candidate's pre-run report. |
| The scan hangs (Realtime silent) | The polling fallback kicks in after 8 s. If it is still frozen, reload: the server render shows the latest state. |
| The CTA errors, or indexing fails | Open the pre-indexed store page of the second candidate, or `/stores/shoperzero-demo`. |
| The computer-use tab is broken | Use `/scan/replay-cu`: offline SVG screenshots, labeled Replay. |
| Claude stalls or picks wrong | Follow up with "Buy the Hoodie from ShoperZero Demo, size M." Otherwise use the WS4 agent script, then `/checkouts/live?replay=spt`. |
| Stripe fails | Use the explicitly labelled Stripe test fallback; if unavailable, show a clearly labelled recorded replay. |
| Woo tunnel down | Open the rehearsal `/checkouts/{id}` plus a screenshot of the Woo order. |
| Network gone | Play the backup video from the matching timestamp and narrate live. |

### 10.4 Backup video plan

- Record **after the second clean rehearsal** with macOS Shift-Cmd-5 or OBS: 1920×1080, no voice, cursor visible.
- Two cuts:
  - (a) the full 2:00;
  - (b) 0:45 of cascade + D → A only.
- Keep both locally and in a cloud-drive link recorded in `runbook.md`. **Do not commit video files.**
- Save 7 screenshots for slides: cascade in progress, report D, computer-use filmstrip, D → A flip, products.json, timeline completed, Woo order.
- Re-record if the UI changes visibly.

### 10.5 Judge Q&A cheat sheet (`docs/demo/qa.md`)

- **"How is the score computed?"** We try three access methods in the order an agent would: API, then reading the page (DOM), then computer use. We score the best method that works plus its capabilities (catalog, price and stock, variants, cart, checkout reachable). API is the top band, DOM the middle, computer use the bottom. The per-task time and cost make the difference concrete: roughly 1 s / $0 against 90 s / $0.30.
- **"Is computer use safe? Does it buy things?"** No. It is capped at 15 steps, runs on public pages only, and **always stops before payment**. Screenshots are shown so you can audit every step.
- **"Why not Shopify's Agentic plan?"** It needs merchant sign-up, a catalog sync into Shopify, and per-sale fees and terms. We're zero-touch, open, emit standard protocols from merchant-owned endpoints, and cover Woo, Magento, BigCommerce, Squarespace and custom stores. The ~4% fee is unverified, so don't quote it.
- **"Readiness scanners already exist (Cloudflare Agent Readiness)."** Scores are commodity. We add the cost-per-task view across three real access methods, and more importantly we **fix** the store in one click and prove it with a completed checkout.
- **"Is crawling legal? robots.txt?"**
  - We honor robots.txt, crawl-delay and Content-Signal.
  - We use an identifiable user agent (`/bot` explains it), at 1–2 requests per second.
  - We read public, logged-out pages only and **never bypass bot protection**; those stores are marked blocked.
  - Images are hotlinked.

  Legal risk is ToS/contract rather than CFAA: hiQ v. LinkedIn (2022; hiQ lost on contract) and Meta v. Bright Data (2024). Consent is handled by the claim and opt-out loop, which is the lesson of Amazon "Buy for Me".
- **"Who's the merchant of record?"** In the demo, the agent pays ShoperZero and we place the order on **our own** Woo store with an offline method plus a receipt note. Third-party stores get a `continue_url` handoff. In production, "we buy from the merchant" would make us a reseller/MoR (tax, chargebacks), so production runs through the merchant plugin or Stripe Connect, with the merchant as MoR.
- **"Isn't this Rye / Channel3 / Crossmint?"** They're closed, per-call, agent-developer side, and often browser automation. We give the merchant open endpoints and a claim loop, and agents use them for free. Our computer-use probe is a diagnostic, not the product.
- **"Stale prices?"** `verifyOffer` checks live before the quote. Woo `expected_total` guards against drift, quotes have a 10-minute TTL, and the total is immutable once awaiting payment.
- **"UCP-compliant?"** We mirror Shopify's live profile (`2026-08-25`, also listing `2026-04-08`) and claim only the capabilities we implement. We have not been certified.
- **"How does claiming stop impostors?"** The token only counts when it is published in that domain's DNS or homepage HTML, like Google Search Console. Tokens sit in a private table.
- **"Business model?"** (Pitch suggestion; not researched.) The scan is free. Endpoints are free for agents. Merchants pay for verified or native checkout, and there is a take rate on agent checkouts.

---

## 11. Milestones and acceptance criteria

Every milestone must pass `npx tsc --noEmit` and `npm run lint` with no new errors, and must render in both light and dark themes with no horizontal scroll at 375 px.

**M0: Shell, tokens and mock (T+0:30)**
- `globals.css` per §8.3; TopBar/Footer in place; the Arial override removed.
- `mock/fixtures/*` type-check.
- With `NEXT_PUBLIC_UI_MOCK=1` and **no Supabase env**, `npm run build && npm start` serves `/`, `/scan/replay-api`, `/scan/replay-dom`, `/scan/replay-cu`, `/scan/replay-none`, `/stores`, `/stores/berlinpackaging-com?from_scan=replay-dom`, `/checkouts/live?replay=spt`, `/claim/berlinpackaging-com` and `/bot`, each with HTTP 200 and no console errors.

**M1: Landing → scan against mock/replay (MVP)**
- The landing form validates the URL. In mock mode it routes to `/scan/replay-dom?demo=1`.
- `/scan/replay-dom` animates: API card failing signal by signal, DOM card passing with a recipe preview of at least 4 rows, computer use "Not needed", then the report with grade D, comparison bars and the "Via ShoperZero" row. Everything is labeled "Replay".
- `/scan/replay-cu` shows the computer-use card streaming 9 screenshots with the step counter, filmstrip, step log, zoom dialog and "Stops before payment". Its CTA reads "Claim this store".
- `/scan/replay-none` shows three blocked cards, grade F, and claim copy.

**M2: Live scan (MVP, never cut)**
- With WS2 landed, submitting a real URL creates a scan (`POST /api/v1/scans` 202) and `/scan/{id}` updates from `scans` Realtime without a reload: probe statuses change and signals appear incrementally. The report renders when `status === "done"`.
- Blocking the websocket in DevTools still completes the page via polling of `GET /api/v1/scans/{id}` within 3 s of each DB change.
- An unknown id → 404 page.

**M3: Make it agent-ready → A (MVP, never cut)**
- On a `dom` scan, the CTA POSTs `/api/v1/stores {store_id, force:true}`. The URL gains `?run=`, and reloading keeps the indexing phase.
- The crawl lane ticks via Realtime, the grade flips to `readiness.after`, and the page auto-navigates to `/stores/{slug}?from_scan={id}`, where GradeHero animates from the scan grade to A.
- `computer_use` and `none` scans show the claim-first CTA.

**M4: Store page (MVP)**
- Five surface rows, each with a working Open ↗ (200 once WS3 lands), a copyable curl, `ConnectAgent` tabs with copy, and a grid of at most 48 products with correct minor-unit money (`4200 USD` → `$42.00`, `4200 JPY` → `¥4,200`).
- The blocked, failed, opted-out, crawling and not-found states render per §7.3.

**M5: Checkout timeline (MVP)**
- During a real agent checkout, `/checkouts/live` attaches on the first event and streams every row in order within about 1 s. It ends with the completed banner, and the Woo order and PaymentIntent links open the right records.
- Viewing the page source shows no buyer email, phone or street.
- A handoff checkout shows the `handoff` terminal node and "Continue on merchant site ↗".

**M6: Metrics + `/bot` (MVP)**
- The strip shows real `PublicMetrics` plus the best-method split. After a new checkout, "Agent checkouts" increases within 10 s with no manual reload.
- If `getUiMetrics` throws, the landing still renders.
- `/bot` renders statically with the opt-out robots snippet.

**M7: Claim (MVP-lite; cut item 8 → slide)**
- `start` is idempotent: the same token on repeat calls, and **no** `store_claims` token rotation unless `rotate` is sent.
- `verify` against a staged TXT or meta tag → `ok:true`, `store.claimed` becomes true, and the store page shows "✓ Verified merchant".
- `opt_out` hides products and `opt_in` restores them. A failed re-verify → 403 `forbidden`.
- Unknown slug → 404 `not_found`; bad body → 400 `validation_error`; a missing record → 200 with `ok:false` and a hint.
- Anon REST `select` on `store_claims` returns nothing (WS1's RLS check).

**M8: Rehearsed (MVP)**
- `docs/demo/{runbook,script,qa}.md` exist.
- The live scan target has been picked and written into `DEMO_PRESETS`.
- Two timed rehearsals of 2:00 ± 10 s are done.
- The backup video is recorded, and at least one `mock/recorded/*.json` scan replay is captured.

**Stretch (in order):**
1. `mode: "full"` before/after view: all three cards run, and a "Compare" toggle on the report.
2. The DOM recipe overlay: hovering a recipe row highlights the matching rectangle on a screenshot, when one exists.
3. The "Copy MCP config" TopBar popover.
4. `opengraph-image.tsx` for `/scan/{id}` with the grade, for shareable reports.
5. ThemeToggle.
6. Issuing virtual card mock in the checkout summary, labeled "simulated".
7. Agent queries live counter.

---

## 12. Contract change requests

Round-1 CCRs 1–11 were **accepted** (DECISIONS B14). The exception is CCR-8's `claim_token`, replaced by B3. Their outcomes are reflected above: the `log` + `created_at` on `CrawlRun`, `cached`/`force` on `POST /api/v1/stores`, early `readiness.before`, `CheckoutEventData` keys, the `timeline_url` message, `rowToStore`/`listStoreProducts`/latest crawl run, `opted_out` on `Store`, the `src/app/api/v1/ui/**` stretch ownership, `NEXT_PUBLIC_UI_MOCK` in `.env.example`, and the Realtime publication.

Round-2 requests:

| # | To | Request | Why | Fallback without it |
|---|---|---|---|---|
| R2-1 | WS1 | Add `best_method: AccessMethod \| "none" \| null` and `latest_scan_id: string \| null` to `Store` (the columns are in DECISIONS §A) and map them in `rowToStore`. | Store header chip, "Indexing now" link, re-scan | `getLatestScanForStore(store.id)` |
| R2-2 | WS2 | Write `scans` **incrementally**: set the probe to `running` with `started_at` when it starts; append `signals` as they arrive; for computer use, append `steps[i]` and `screenshots[i]` per step; throttle to ≤ 2 row updates per second, flushing on every status change. Screenshots must be Storage public URLs; **never base64 in the row**. Keep untried probes present as `pending`, then `skipped`. | "Signals as they arrive" and live screenshots through Realtime | The cards update only at probe boundaries |
| R2-3 | WS2 | Fill `est_seconds_per_task` / `est_usd_per_task` for **every** probe, including `skipped` ones (typical values), so the comparison table is complete. | Report headline | UI `TYPICAL_COST`, labeled "(typical)" |
| R2-4 | WS2 | `POST /api/v1/stores` accepts `{store_id, force?, max_products?}` (DECISIONS says `{url}` or `{store_id}`), with the same response shape `{store, crawl_run_id, status, reused, cached}`. | The CTA indexes the scanned store fast (`max_products: 40` in demo mode) | POST `{url: scan.url, force: true}` |
| R2-5 | WS1 + WS2 | Settle one `CrawlLogEntry` shape. Spec 00 has `{at, level, msg, data?}` and spec 02 has `{t, step, level, msg, data?}`. Recommendation: spec 00's `at` plus an optional `step: CrawlStep`. | StageRail | WS5 normalizer `logTime`/`logStep` (§6.3) |
| R2-6 | WS1 | Confirm `scans` has public-read RLS, is in `supabase_realtime`, and that `getScan(id)` returns `ScanReport \| null` (camelCase-free, i.e. the same field names as the contract). | Realtime + SSR | Direct select + `rowToScanReport` in WS5 |
| R2-7 | WS2 | Add `report_url: "{APP_URL}/scan/{id}"` to the `POST /api/v1/scans` response and to the MCP `scan_store` result, so Claude can print a link to the human report. | Shareable report; Claude can hand the human the page | WS5 builds the URL from `scan_id` |
| R2-8 | WS1 | (a) Document the TXT host convention `_shoperzero.<host>` (apex also accepted) next to `StoreClaim`. (b) Optionally add `getOrCreateClaim(storeId, method)` that never rotates. | Stable tokens for DNS pre-staging | WS5 calls `getClaim` before `upsertClaim` (§7.5) |
| R2-9 | WS1 | Optionally extend `PublicMetrics` / `get_public_metrics` with `median_seconds_to_ready`, `stores_by_best_method` and `orders_by_rail`. | One query for the strip | WS5 computes the extras in `_lib/metrics.ts` |
| R2-10 | WS2 | Scan errors from `POST /api/v1/scans` use B11 codes: `validation_error` (bad URL), `forbidden` (opted out), `rate_limited`, `upstream_blocked`. A scan that hits a challenge still returns 202 and records `blocked` probes. | Inline form errors vs report states | Generic error text |

---

## 13. UNVERIFIED register

| Item | Where | Fallback |
|---|---|---|
| Supabase Realtime payload size limit for large `scans.probes` rows | §6.3 | Payload guard → `reconcile()` via REST |
| Claude Desktop "Settings → Connectors → Add custom connector" path and plan requirement | §7.3, §10.1 | Config-file tab (`mcp-remote`) or Claude Code |
| `mcp-remote` package name and args | §7.3 | Claude Code CLI tab |
| `claude mcp add --transport http <name> <url>` flag spelling | §7.3 | `claude mcp add --help` |
| Claude Desktop remembers "Always allow" | §10.1 | Narrate over the prompts |
| Stripe dashboard URL `https://dashboard.stripe.com/test/payments/{pi}` | §6.4 | Show the id with copy |
| `Instrument_Serif` export in `next/font/google` | §8.2 | Geist italic |
| `berlinpackaging.com` lands in `dom` and indexes 40 products in < 30 s | §10.1 | Pick another candidate at T-60, or use `/scan/replay-dom` |
| Woo sample data has hoodies under $50 | §10.1 | Create one in wp-admin |
| `createBrowserClient` is a singleton | §6.3 | The module-level cache makes it moot |
