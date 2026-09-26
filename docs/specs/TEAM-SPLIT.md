# Team split (2 people)

The specs define five workstreams (WS1–WS5). Which files each one owns is in [00 §3.2](00-overview-and-contracts.md). This page assigns them to two people.

| | **Allen** | **Pierre** |
|---|---|---|
| Theme | What agents and visitors see | Everything that talks to merchant stores |
| Order | WS1 → WS3 → WS5 | WS4 spikes → WS4 → WS2 |
| Specs | [01-foundation](01-foundation.md), [03-agent-surface](03-agent-surface.md), [05-web-ui-demo](05-web-ui-demo.md) | [04-checkout-payments](04-checkout-payments.md), [02-ingestion](02-ingestion.md) |
| First step | Push contracts, the core migration and db helper stubs by **T+30** (this unblocks everyone) | At T+0, no dependencies: Stripe SPT spike, x402 facilitator and wallet spike, WooCommerce Docker store + tunnel |

## Allen
1. **WS1 foundation (01):** package install, `src/lib/contracts/**`, the core migration and seed, `src/lib/db/**`, the proxy matcher, `.env.example`. Push by T+30, then freeze the contracts.
2. **WS3 agent surface (03):** `/api/mcp` (catalog tools, plus composing the crawl and checkout registrars), `products.json`, `llms.txt`, `/.well-known/ucp`, the REST read API.
3. **WS5 web UI (05):** landing → `/scan/{id}` live cascade → score report → "Make it agent-ready" → store page; checkout timeline; `/bot`; claim flow; demo runbook.

## Pierre
1. **WS4 spikes (04, top section):** confirm the Stripe SPT test helper and x402 facilitator work, fund the Base Sepolia wallet, and get the Woo demo store up behind a tunnel.
2. **WS4 checkout (04):** state machine, Woo connector, handoff connector, the Stripe SPT rail, then x402, then `registerCheckoutTools`.
3. **WS2 ingestion and scan (02):** scan cascade (`api` → `dom` → `computer_use`), scoring, `/api/v1/scans`, then crawl and indexing, then `registerCrawlTools`.

## Sync points (00 §7)
- **T+30:** contracts pushed. Pierre pulls and builds against them.
- **T+2h:** Claude, connected to `/api/mcp`, finds and buys a product on the Woo demo store.
- **T+4h:** a live scan → "Make it agent-ready" → grade A, running end to end in the UI.
- **Final hour:** pre-crawl the demo stores, rehearse twice, record a backup video.

## If Pierre's side runs behind
The riskier half is WS2 + WS4. Cut in this order:
1. The `computer_use` probe (its card shows "skipped").
2. The x402 rail (keep Stripe).
3. Everything else marked stretch.

After the UI is done, Allen can take over `src/lib/scan/score.ts` and `run.ts`.

## Rules
- Short feature branches, merged to `main` often. Every push to `main` deploys (Supabase migrations, then Vercel), so merge only once the build passes.
- Migrations are add-only, with a new timestamped file each time.
- Contract changes after T+30 need a quick message to each other first.
