# Checkout demonstration

## Start and rehearse

```sh
npm ci
npm run demo:provence
# In another terminal:
npm run demo:agent
```

The launcher starts Lumière before (4001), Lumière after (4002), and checkout (4174), waits for the catalog, and stops its child processes together. Stop any earlier demo occupying these ports first. To use a production build, stop the running launcher, run `npm run build`, and then run `npm run demo:provence -- --production`. Restart after each build so the server and browser assets use the same build.

Open http://127.0.0.1:4174/demo/checkout. Select a product, size and quantity; create the checkout, select shipping and confirm. The default is Shea Butter Hand Cream, 75 ml (`01HC075`): $24 + $6.95 shipping + $1.98 tax = $32.93. Express costs $14.95; standard shipping is free from $65. Prices use USD integer cents inside ShopperZero.

The resulting `LDP…` order appears at http://127.0.0.1:4002/__demo/orders and through the merchant receipt link. ShopperZero's receipt, payment reference and merchant record identify the same purchase. `demo:agent` discovers the variant through MCP, confirms it, repeats confirmation, and saves evidence under `artifacts/mock-checkout`.

## Data and configuration

- `.mock-checkout/ledger.json`: checkout sessions, events, idempotency keys and simulated payment records.
- `.demo-stores/provence-orders.json`: merchant orders, sequence and inventory consumption. Cancellation restores availability.
- Both directories are ignored by Git. Existing receipts are preserved, including earlier fixture purchases.
- `PROVENCE_STORE_URL`: local after-store origin (default `http://127.0.0.1:4002`). Only explicitly configured loopback HTTP origins are accepted; redirects are rejected.
- `PROVENCE_DATA_FILE` and `MOCK_CHECKOUT_DATA_FILE`: optional persistence locations.
- `MOCK_CHECKOUT_APP_URL`: checkout application origin.
- `SHOPPERZERO_MOCK_ENABLED=1`: enables the local service. `CHECKOUT_DEMO_STORE=fixtures` selects the earlier isolated fixture implementation for regression tests.

Payments remain simulated and accept only `mock_card_visa`, `mock_card_declined`, or `mock_card_requires_action`. The native storefront never charges a card. The before-store still rejects declared shopping agents and retains its original variant bug.

## Interfaces

REST checkout and order paths are unchanged: `/api/v1/checkouts`, `/api/v1/checkouts/{id}`, completion/cancellation/event subroutes, and `/api/v1/orders/{id}`. The demonstration helper `/api/mock/checkouts` accepts `scenario` and optional `variant_id` and `quantity`; shipping uses the existing update endpoint.

`/api/mock/mcp` exposes catalog helpers and the six checkout/order tools. `/api/mcp` serves the same local assembly; `/api/ucp/mcp` is the composed catalog/crawl/checkout agent surface backed by the shared services. Canonical schemas are in `src/contracts`; the checkout feature adds explicit simulation metadata. `src/infrastructure/mcp/checkout-tools.ts` provides the registrar with its default service; the feature registrar supports injected services.

The `provence_demo` connector uses the storefront's existing cart, shipping and order routes with structured JSON responses. It reads the public Shopify-shaped catalog and checks currency, price and live stock through the native SFCC variant endpoint. Native master IDs and SKU strings map to stable UUIDs, including receipts created before the catalog format changed. Order creation carries the checkout UUID, simulated payment reference and approved total. Pending authorization is persisted before placement. A timeout retains the pending state; Retry checkout reconciles the merchant record before another purchase. Capture failure cancels the merchant order and releases authorization, including after an interrupted cancellation.

## Scenarios and verification

The scenario selector covers successful purchase, declined payment, buyer approval, unavailable stock, changed price, failed placement, failed capture and merchant handoff. The unavailable variant is Rose Petal Face Mist, 150 ml. Price-change injection affects only its checkout and requires fresh confirmation.

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm run test:integration
npm run test:browser
```

Integration tests start isolated storefronts and app servers with temporary ledgers. They verify shipping, exact SKU selection, REST/MCP equivalence, simultaneous purchases, idempotency, lost responses, cancellation and restarts. Browser tests exercise the running demo on desktop and mobile, record a video and reject non-local requests from checkout. They also cover the before/after storefronts and prove that a purchase completed outside the browser updates its open checkout and timeline without reloading. Active checkouts poll once per second; polling stops in terminal states.

This local flow uses UCP-shaped sessions; it does not assert full UCP conformance. The scanner, published catalog and Supabase-backed product UI remain separate workstreams. No live payment integration is part of this demonstration.
