# Team split (3 people)

The specs define five workstreams (WS1–WS5). Which files each one owns is in [00 §3.2](00-overview-and-contracts.md). This page assigns them to three people.

| | **Allen** | **Pierre** | **Chee19** |
|---|---|---|---|
| Theme | What agents and visitors see | Checkout and payments | Scanning and indexing merchant stores |
| Workstreams | WS1 → WS3 → WS5 | WS4 | WS2 |
| Specs | [01-foundation](01-foundation.md), [03-agent-surface](03-agent-surface.md), [05-web-ui-demo](05-web-ui-demo.md) | [04-checkout-payments](04-checkout-payments.md) | [02-ingestion](02-ingestion.md) |
| First step | Push contracts, the core migration and db helper stubs by **T+30** (this unblocks everyone) | At T+0, no dependencies: Stripe SPT spike, x402 facilitator and wallet spike, WooCommerce Docker store + tunnel | At T+0, no dependencies: fetch layer, platform detection, and API / JSON-LD probes against the demo store fixtures, as pure modules |

## Allen: WS1 → WS3 → WS5
1. **WS1 foundation (01):** package install, `src/lib/contracts/**`, the core migration and seed, `src/lib/db/**`, the proxy matcher, `.env.example`, and `infra/woo/.env.woo` in `.gitignore`. Push by T+30, then freeze the contracts.
2. **WS3 agent surface (03):** `/api/mcp` (catalog tools, plus composing Chee19's crawl registrar and Pierre's checkout registrar), `products.json`, `llms.txt`, `/.well-known/ucp`, the REST read API.
3. **WS5 web UI (05):** landing → `/scan/{id}` live cascade → score report → "Make it agent-ready" → store page; checkout timeline; `/bot`; claim flow; demo runbook.

## Pierre: WS4
1. **Spikes (04, top section):** confirm the Stripe SPT test helper and x402 facilitator work, fund the Base Sepolia wallet, and get the Woo demo store up behind a tunnel.
2. **Checkout (04):** state machine, Woo connector, handoff connector, the Stripe SPT rail, then x402, then `registerCheckoutTools`, then the demo wallet MCP.
3. **Stretch:** the `browser` connector that replays the scan's `dom_recipe`.

## Chee19: WS2
1. **Before T+30 (pure modules, no DB):** `src/lib/crawl/fetch.ts` and `detect.ts`, the platform adapters, the sitemap and JSON-LD parsers.
2. **Scan & score (02 §6):** `src/lib/scan/**`, covering the `api` probe, the `dom` probe with its recipe, `score.ts` and `run.ts`, then `POST`/`GET /api/v1/scans`. The `computer_use` probe comes last.
3. **Indexing:** `crawlStore`, `POST /api/v1/stores`, crawl-run progress, `verifyOffer`, then `registerCrawlTools` (`index_store`, `get_crawl_status`, `scan_store`, `get_scan`).

## Hand-offs between people
| From → To | What | When |
|---|---|---|
| Allen → everyone | `src/lib/contracts/**`, db helper stubs, migration | T+30 |
| Chee19 → Allen | `POST /api/v1/scans` + Realtime writes to `scans` (the UI's scan page), `registerCrawlTools` | ~T+2h |
| Chee19 → Pierre | Woo `variant.external_id` = Store API purchasable id (B9); `stores.best_method` / `dom_recipe` | with the Woo adapter |
| Pierre → Allen | `registerCheckoutTools`, `checkout_events` writes (checkout timeline) | ~T+2h |

## Sync points (00 §7)
- **T+30:** contracts pushed. Pierre and Chee19 pull them and wire their modules to the db helpers.
- **T+2h:** Claude, connected to `/api/mcp`, finds and buys a product on the Woo demo store.
- **T+4h:** a live scan → "Make it agent-ready" → grade A, running end to end in the UI.
- **Final hour:** pre-crawl the demo stores, rehearse twice, record a backup video.

## If someone runs behind
Cut in this order:
1. The `computer_use` probe (its card shows "skipped").
2. The x402 rail (keep Stripe).
3. Everything else marked stretch.

**Never cut:** the Woo adapter + JSON-LD engine, `products.json`, MCP `search_catalog` / `get_product` / `create_checkout` / `complete_checkout`, the Woo connector with one payment rail, and the live scan UI.

## Rules
- Short feature branches, merged to `main` often. Every push to `main` deploys (Supabase migrations, then Vercel), so merge only once the build passes.
- Migrations are add-only, with a new timestamped file each time.
- Contract changes after T+30 need a quick message to the other two first.
