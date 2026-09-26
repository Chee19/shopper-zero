# ShoperZero research

Research for the hackathon build, 2026-09-26. Start with **00-SYNTHESIS.md**. It holds the decisions, contracts and workstreams. The rest is supporting detail with sources; items marked UNVERIFIED still need checking.

| File | What it covers |
|---|---|
| [00-SYNTHESIS.md](00-SYNTHESIS.md) | Product definition, 2-min demo, key decisions (with the contradictions between tracks resolved), architecture, Supabase schema, shared TypeScript contracts, MCP tool list, 5 parallel workstreams, risks and cut list |
| [01-agentic-commerce-protocols.md](01-agentic-commerce-protocols.md) | UCP (Google/Shopify), ACP (OpenAI/Stripe), AP2, Visa TAP and Mastercard: shapes, endpoints and versions. Recommends emulating UCP. |
| [02-x402-payments.md](02-x402-payments.md) | x402 v2 (`@x402/*@2.27.0`): headers, the Base Sepolia facilitator, `withX402` in Next 16, per-cart pricing, the upfront flow, the agent client |
| [03-stripe-agentic-payments.md](03-stripe-agentic-payments.md) | Stripe Shared Payment Tokens, Issuing for agents, Link Agent Wallet, MPP, x402-on-Stripe, catalog import. What's gated and what works in test mode. |
| [04-platform-detection-and-apis.md](04-platform-detection-and-apis.md) | Detecting WooCommerce, Magento, SFCC, BigCommerce, Squarespace and others. Public catalog and cart endpoints (checked live), bot-protection findings, demo stores. |
| [05-generic-extraction-pipeline.md](05-generic-extraction-pipeline.md) | Tiered crawl (platform API → sitemap + JSON-LD → render → Claude), parser sketches, libraries, Vercel vs Supabase runtime, pgmq queue, re-crawl, legal |
| [06-agent-index-and-discoverability.md](06-agent-index-and-discoverability.md) | Shopify `products.json` shape, UCP `/.well-known/ucp` + MCP (checked live), ACP feed, llms.txt, MCP in Next 16, hybrid search SQL, URL layout |
| [07-checkout-execution.md](07-checkout-execution.md) | Headless checkout (Woo Store API, Magento guest REST), why cards need a browser, SPT/x402 payment leg, Stagehand/Rye fallbacks, state machine, Woo demo store in Docker |
| [08-competitive-landscape.md](08-competitive-landscape.md) | Shopify Agentic plan, Rye, Channel3, Crossmint, PayPal/Copilot, readiness scanners. Gap analysis, positioning, demo script, metrics. |
