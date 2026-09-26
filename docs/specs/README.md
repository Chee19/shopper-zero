# ShoperZero specs

Read them in this order. **`DECISIONS.md` is binding: where any spec disagrees with it, `DECISIONS.md` wins.** After it, spec 00 wins over specs 01–05.

| # | File | What it covers |
|---|---|---|
| 1 | [DECISIONS.md](DECISIONS.md) | Round-2 binding decisions: the scan-and-score feature (the `api` → `dom` → `computer_use` cascade, `ScanReport`, `scans`) and how conflicts B1–B16 between the specs were resolved |
| 2 | [00-overview-and-contracts.md](00-overview-and-contracts.md) | Product, 2-minute demo, repo layout and ownership, conventions, env vars, canonical TypeScript contracts, MCP tool table, db helper signatures, milestones |
| 3 | [01-foundation.md](01-foundation.md) | WS1: package install, core migration SQL (incl. `scans` and the `scan-screenshots` bucket), seed, db helpers, shared helpers, `.env.example` |
| 4 | [02-ingestion.md](02-ingestion.md) | WS2: store scan (access cascade and scoring), platform detection, crawl adapters, JSON-LD engine, readiness, crawl/scan routes and MCP tools |
| 5 | [03-agent-surface.md](03-agent-surface.md) | WS3: MCP server and instrumentation, REST read API, `products.json` / UCP / ACP / `llms.txt` outputs, discovery files |
| 6 | [04-checkout-payments.md](04-checkout-payments.md) | WS4: checkout service and state machine, Woo and handoff connectors, Stripe SPT and x402 rails, demo wallet, Woo demo store |
| 7 | [05-web-ui-demo.md](05-web-ui-demo.md) | WS5: scan-first landing, live scan page and score report, store and checkout pages, claim flow, `/bot`, demo script |
| 8 | [../research/README.md](../research/README.md) | Background research with sources (protocols, payments, platform APIs, extraction, competition); start with its `00-SYNTHESIS.md` |
