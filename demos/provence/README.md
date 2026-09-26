# Lumière de Provence: before/after demo store

A local storefront for demoing Shopper Zero. It is modelled on how a large Salesforce
Commerce Cloud beauty store works (SKU-suffixed product URLs, `Cart-AddProduct`
controllers, a cookie wall, a CDN bot check at checkout), under a **fictional brand** with
original copy and drawn product art. It has no dependencies, makes no network calls, keeps before-store orders in memory and persists after-store orders locally. It never takes a payment.

```bash
npm run demo:stores   # before → http://localhost:4001/en-us/   after → http://localhost:4002/en-us/
npm run demo:before   # one at a time
npm run demo:after
```

Orders placed in either store: `GET /__demo/orders`.

## What changes between the two

| Stage | Before (4001) | After (4002) |
|---|---|---|
| Discover | Category grids load by XHR; no `llms.txt` or product feed; robots.txt disallows cart and checkout | Server-rendered grids, `/llms.txt`, `/products.json`, robots.txt welcomes shopping agents |
| Understand | Price only appears after JavaScript; no JSON-LD, no `og:price` | `ProductGroup` JSON-LD with per-size `Offer`s, `og:price:*`, price in HTML |
| Availability | Stock only via the `Product-Variation` XHR | `availability` in JSON-LD and on the page |
| Cart | **Wrong-size bug**: picking 75 ml adds 150 ml (1-based swatch index into a 0-based array); the toast still says 75 ml | Plain `<form>` with a radio per SKU; `?pid=` deep links |
| Ship & policy | Shipping and returns only in a pop-up; bag says "Calculated at checkout" | Rates, delivery times and returns as text on the product page and in JSON-LD; bag shows the shipping cost |
| Checkout | Edge bot wall: declared agents (UA contains `bot`, `agent`, `claude`, `gpt`, `ShopperZero`, … or send `Signature-Agent`) get 403; automated browsers (`navigator.webdriver`) stall on the interstitial | No bot wall; guest checkout ends with a test order |
| Friction | Full-screen cookie wall plus a newsletter pop-up after 2.5 s | Small, non-blocking consent bar |

A person in an ordinary browser can complete checkout in both modes. The before store's
interstitial clears after about 1.5 s.

## Connected checkout

From the repository root, `npm run demo:provence` starts both stores and ShopperZero checkout on port 4174. The after store supports JSON responses (`Accept: application/json`) on its native checkout and shipping routes. Place-order requests carry `checkout_id`, `payment_reference` and `expected_total` (integer cents); replay returns the existing order.

After-store orders live in `.demo-stores/provence-orders.json`, or `PROVENCE_DATA_FILE`. Remaining stock is derived from placed orders; canceled orders release stock. `GET /__demo/orders?checkout_id=<id>` reconciles a ShopperZero purchase. `POST /__demo/orders/<LDP id>/cancel` with `{ "checkout_id": "…" }` cancels it idempotently. These additions are available only in after mode; the before checkout gate is preserved. Store servers bind to loopback.
