# 02 — x402 (HTTP 402 payments) for ShoperZero checkout

_Researched 2026-09-26 against live sources (GitHub `x402-foundation/x402@main`, npm registry, live facilitator `/supported`, CDP + Stripe docs). Items I could not confirm are marked **UNVERIFIED**._

---

## TL;DR

- **Use x402 v2 and the `@x402/*` packages (all at `2.27.0` on npm).** The legacy `x402-next` / `x402-fetch` / `x402` packages are frozen at `1.2.0`. Don't use them. The repo moved to **github.com/x402-foundation/x402**; the protocol now lives in a Linux Foundation project that Coinbase and Cloudflare co-founded.
- **v2 headers:** server sends `PAYMENT-REQUIRED` (base64 JSON) with HTTP 402. Client retries with `PAYMENT-SIGNATURE` (base64 JSON). Server returns `PAYMENT-RESPONSE` (base64 settlement receipt). v1's `X-PAYMENT` / `X-PAYMENT-RESPONSE` are legacy. Networks use CAIP-2 ids: `eip155:84532` is Base Sepolia, `eip155:8453` is Base.
- **Free testnet facilitator: `https://x402.org/facilitator`.** It needs no keys. I checked it live: it supports `exact` + `upto` + `batch-settlement` on Base Sepolia, and `exact` on Solana devnet. Mainnet uses the **CDP facilitator**: first 1,000 settlements per month free, then $0.001 each, auth via `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`.
- **Dynamic cart pricing is supported natively.** `price` in a route config can be a function `(ctx: HTTPRequestContext) => Price | Promise<Price>`, and `payTo` can be a function too. Look up a **frozen quote/cart by id** from the path and return `"$42.17"`. The price gets recomputed on the paid retry, so the quote must not change between the 402 and the retry.
- **For physical goods, use `extra: { paymentFlow: "upfront" }` on the `exact` scheme.** The facilitator then settles on-chain **before** your handler runs, so the handler only creates or fulfils an order for money that has actually arrived. The default flow (verify → handler → settle) could create an order whose settlement then fails.
- **Next 16: use `withX402` in a route handler. Don't use `paymentProxy` in `src/proxy.ts`.** Our `proxy.ts` already runs Supabase session refresh and excludes `/api/agent/*`. `withX402` also settles only if the handler returns <400. The official Next example already targets `next@^16.2.6`.
- **Agent side:** `wrapFetchWithPayment(fetch, client)` from `@x402/fetch`. The client is either (a) `x402Client` + `ExactEvmScheme(privateKeyToAccount(pk))`, or (b) **`CdpX402Client` from `@coinbase/cdp-sdk/x402`**. (b) gives a managed wallet with no key handling and built-in spend caps. `setSpendControls({ maxAmountPerPayment })` matters for carts.
- **Ecosystem:** Stripe accepts x402 on Base. It records the on-chain payment as a PaymentIntent via `transaction_verification`, but you need a live account plus approval. Cloudflare's Monetization Gateway (x402 at the edge) is waitlist-only and aimed at API/content micropayments, not checkout. `@x402/mcp` exists for paid MCP tools. The Bazaar discovery index is public at `GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources`.

---

## 1. Spec: v1 vs v2

Source: [specs/x402-specification-v2.md](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md), [x402 V2 launch post](https://www.x402.org/writing/x402-v2-launch).

| | v1 (legacy) | v2 (current) |
|---|---|---|
| 402 payload | JSON body | base64 JSON in `PAYMENT-REQUIRED` header (body is free-form) |
| Client payment header | `X-PAYMENT` | `PAYMENT-SIGNATURE` |
| Settlement receipt header | `X-PAYMENT-RESPONSE` | `PAYMENT-RESPONSE` |
| Network ids | `base-sepolia`, `solana-devnet` | CAIP-2: `eip155:84532`, `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |
| Amount field | `maxAmountRequired` | `amount` (atomic units, string) |
| Extensions | none | `extensions` map (bazaar, payment-identifier, sign-in-with-x, …) |

The SDK server code accepts both (`req.headers["payment-signature"] || req.headers["x-payment"]`), and the x402.org facilitator still lists v1 kinds.

### PaymentRequired (decoded `PAYMENT-REQUIRED` header)
```json
{
  "x402Version": 2,
  "error": "PAYMENT-SIGNATURE header is required",
  "resource": { "url": "https://api.example.com/premium-data", "description": "...", "mimeType": "application/json" },
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:84532",
    "amount": "10000",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "payTo": "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
    "maxTimeoutSeconds": 60,
    "extra": { "name": "USDC", "version": "2" }
  }],
  "extensions": {}
}
```
USDC has 6 decimals, so `"10000"` is $0.01. Base Sepolia USDC is `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, and Base mainnet USDC is `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`. With `price: "$12.34"` the SDK fills in `asset` and `amount` for the network's default USDC automatically.

### PaymentPayload (decoded `PAYMENT-SIGNATURE`) — exact/EVM uses EIP-3009 `transferWithAuthorization`
```json
{
  "x402Version": 2,
  "resource": { "url": "..." },
  "accepted": { /* the chosen PaymentRequirements */ },
  "payload": {
    "signature": "0x2d6a...",
    "authorization": { "from": "0x857b...", "to": "0x2096...", "value": "10000",
                       "validAfter": "1740672089", "validBefore": "1740672154", "nonce": "0xf374..." }
  },
  "extensions": {}
}
```

### Facilitator API
- `POST /verify` `{ x402Version, paymentPayload, paymentRequirements }` returns `{ isValid, invalidReason?, payer }`
- `POST /settle` (same body) returns `{ success, errorReason?, payer, transaction, network }`
- `GET /supported` returns `{ kinds: [{x402Version, scheme, network, extra?}], extensions, signers }`
- Useful error codes: `insufficient_funds`, `invalid_exact_evm_payload_authorization_value_mismatch`, `..._valid_before` (expired), `..._recipient_mismatch`, `settlement_pending` (non-terminal: the tx was broadcast but its confirmation is unknown).

### Schemes (in [specs/schemes](https://github.com/x402-foundation/x402/tree/main/specs/schemes))
| Scheme | What | Use for us? |
|---|---|---|
| `exact` | Fixed amount, one transfer (EIP-3009 on EVM) | **Yes. Cart total is known before payment.** |
| `upto` | Client authorizes a max, server settles ≤ max (Permit2) via `setSettlementOverrides(res, {amount})` | Maybe. Useful if shipping or tax is finalized after the order call. Testnet facilitator supports it on Base Sepolia. |
| `auth-capture` | Authorize → hold (escrow) → capture/void/refund, with capture and refund deadlines | Ideal on paper for physical goods (refunds, ship-then-capture). **Not offered by the x402.org testnet facilitator**, so treat it as a pitch slide only. |
| `batch-settlement` | Off-chain vouchers claimed in batches | No (micropayments). |

Payment flows (`extra.paymentFlow`): the default `authorization` flow runs verify → handler → settle. **`upfront`** settles before the handler (example: [servers/upfront](https://github.com/x402-foundation/x402/tree/main/examples/typescript/servers/upfront)). `escrow` belongs to auth-capture.

### Live check of the free testnet facilitator (`curl https://x402.org/facilitator/supported`, 2026-09-26)
`exact` on eip155:84532, `upto` on eip155:84532 (facilitatorAddress `0xd407…f1bf`), `batch-settlement` on eip155:84532, `exact` on Solana devnet, plus Algorand, Aptos, Stellar and Hedera testnets. It also lists v1 `base-sepolia` and `solana-devnet`. Extensions: `builder-code`, `eip2612GasSponsoring`, `erc20ApprovalGasSponsoring`. The facilitator pays gas, so buyers only need USDC.

---

## 2. Packages (npm, verified 2026-09-26)

| Package | Version | Role |
|---|---|---|
| `@x402/core` | 2.27.0 | `x402ResourceServer`, `HTTPFacilitatorClient` (`@x402/core/server`), `x402Client` (`@x402/core/client`), types (`@x402/core/types`) |
| `@x402/next` | 2.27.0 | `withX402`, `paymentProxy`, `setSettlementOverrides`, re-exports `x402ResourceServer` |
| `@x402/evm` | 2.27.0 | `ExactEvmScheme` (`/exact/server`, `/exact/client`), `UptoEvmScheme` (`/upto/*`), auth-capture |
| `@x402/svm` | 2.27.0 | Solana schemes (optional) |
| `@x402/fetch` / `@x402/axios` | 2.27.0 | Client wrappers: `wrapFetchWithPayment`, `x402Client`, `x402HTTPClient` |
| `@x402/extensions` | 2.27.0 | `declareDiscoveryExtension` (`/bazaar`), payment-identifier, sign-in-with-x |
| `@x402/mcp` | 2.27.0 | `createPaymentWrapper` (server), `createx402MCPClient` (client) |
| `@x402/paywall` | 2.27.0 | Browser paywall UI (for humans, not needed for agents) |
| `@coinbase/cdp-sdk` | 1.57.0 | `@coinbase/cdp-sdk/x402` exports `CdpX402Client` (buyer), `createCdpFacilitatorClient`, `createX402Server` |
| `@coinbase/x402` | 2.1.0 | Older CDP helper `createFacilitatorConfig(keyId, secret)`. Stripe docs still use it. Either works. |
| `x402-next`, `x402-fetch`, `x402` | 1.2.0 | **Legacy v1. Skip.** |
| `x402-mcp` (Vercel) | 0.1.1 | Old v1-era Vercel helper. **Skip**; use `@x402/mcp`. |

Install for our app (**teammate runs this; I did not install anything**):
```bash
npm i @x402/core @x402/next @x402/evm @x402/fetch @x402/extensions viem
# optional: @coinbase/cdp-sdk (CDP facilitator on mainnet + managed agent wallet), @x402/mcp
```

---

## 3. Next.js 16 integration

`@x402/next` has two entry points ([README](https://github.com/x402-foundation/x402/blob/main/typescript/packages/http/next/README.md)):

1. **`paymentProxy(routes, server, …)`** is exported as `proxy` from `proxy.ts`. It is meant for pages, and it **charges even if the API returns an error**. We already have `src/proxy.ts` doing Supabase `updateSession`, with a matcher that **excludes `/api/agent`**. Composing the two is possible but unnecessary.
2. **`withX402(handler, routes, server, paywallConfig?, paywall?, syncFacilitatorOnStart?)`** wraps an App Router route handler. **Use this.** It settles only when the handler returns status < 400, it supports any HTTP method export (`GET`/`POST`), and its adapter reads the body via `req.clone()`, so the handler can still `await req.json()`.
   - Static route: pass a bare `RouteConfig`.
   - Dynamic segments: key the config by the pattern, e.g. `{ "/api/agent/checkout/[quoteId]/pay": config }`. **If the pattern does not match the served path, the handler runs WITHOUT payment.** The SDK only logs a warning, so test it.

The official full-stack example [`examples/typescript/fullstack/next`](https://github.com/x402-foundation/x402/tree/main/examples/typescript/fullstack/next) pins `next@^16.2.6`, and the CDP example [`cdp-sdk/examples/typescript/x402/servers/next`](https://github.com/coinbase/cdp-sdk/tree/main/examples/typescript/x402/servers/next) does the same. Both use `withX402` in route handlers.

### Dynamic price (the key feature for carts)
From `x402HTTPResourceServer.ts`:
```ts
export type DynamicPrice = (context: HTTPRequestContext) => Price | Promise<Price>;
export type DynamicPayTo = (context: HTTPRequestContext) => string | Promise<string>;
export interface HTTPRequestContext { adapter: HTTPAdapter; path: string; method: string; paymentHeader?: string; routePattern?: string; decodedPath?: string; }
// adapter: getHeader, getMethod, getPath, getUrl, getQueryParam(s), getBody()
```
`Price` accepts `"$12.34"` (USD-denominated, uses the network's default USDC) or an atomic `{ amount, asset }` object (**UNVERIFIED exact shape; use the `"$x.yy"` string**).

---

## 4. Physical-goods checkout design (dynamic amount per cart)

**Problem:** x402 was designed for "fixed price per URL", and a cart total is per-request. **Solution:** make the *URL* identify an immutable, server-priced **quote**.

```
Agent                          ShoperZero (Next.js)                       Facilitator        Chain
 |  POST /api/agent/checkout/quote {store, items, shipping}  |                 |                 |
 |------------------------------------------------------------>| price items from index, tax/ship estimate
 |  201 {quoteId, total:"$42.17", expiresAt, payUrl}           | insert quotes row (status=open, 15 min TTL)
 |<------------------------------------------------------------|
 |  POST payUrl  (no payment)                                   |
 |------------------------------------------------------------>| DynamicPrice → load quote → "$42.17"
 |  402 + PAYMENT-REQUIRED {accepts:[exact, eip155:84532, amount 42170000, payTo]}
 |<------------------------------------------------------------|
 |  sign EIP-3009 auth (wallet)                                 |
 |  POST payUrl + PAYMENT-SIGNATURE                             |
 |------------------------------------------------------------>| DynamicPrice again (same quote → same amount)
 |                                                              |-- /verify -->|
 |                                                              |-- /settle -->|-- transferWithAuthorization -->|
 |                                                              |<- tx hash ---|   (upfront: before handler)
 |                                                              | handler: mark quote paid, create order, enqueue fulfilment
 |  200 {orderId, status} + PAYMENT-RESPONSE {transaction}      |
 |<------------------------------------------------------------|
```

Rules:
- The **server** computes the total from our catalog index. The agent never supplies a price.
- A quote is **immutable** once issued. If the cart changes, issue a new quote. If the quote is expired or already paid, the DynamicPrice function throws or returns an error response so no one pays for a dead quote. The retry re-runs `price()`, and any change makes verify fail with `value_mismatch`.
- **Idempotency:** the order insert uses a unique `quote_id`, so a replayed retry can't create a second order. EIP-3009 nonces already stop double-settlement on-chain. Optionally add the `payment-identifier` extension.
- Store `tx hash`, `payer`, `network` from the settlement on the order.
- `maxTimeoutSeconds`: 60–300 is enough.

### Server sketch: `src/lib/x402/server.ts`
```ts
import "server-only";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
// Mainnet alternative: import { createCdpFacilitatorClient } from "@coinbase/cdp-sdk/x402";

export const X402_NETWORK = (process.env.X402_NETWORK ?? "eip155:84532") as `${string}:${string}`; // Base Sepolia
export const PAY_TO = process.env.X402_PAY_TO!; // our receiving EVM address

const facilitator = new HTTPFacilitatorClient({
  url: process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
});
// const facilitator = createCdpFacilitatorClient(); // reads CDP_API_KEY_ID / CDP_API_KEY_SECRET

export const x402 = new x402ResourceServer(facilitator).register(X402_NETWORK, new ExactEvmScheme());

// Optional: audit trail / Stripe PaymentIntent recording (hook exists per Stripe docs)
x402.onAfterSettle(async ({ result, requirements }) => {
  if (!result.success) return;
  console.log("[x402] settled", result.transaction, requirements.amount);
});
```

### Route: `src/app/api/agent/checkout/[quoteId]/pay/route.ts`
(`/api/agent/*` is already excluded from our Supabase `proxy.ts` matcher.)
```ts
import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar"; // optional
import { x402, X402_NETWORK, PAY_TO } from "@/lib/x402/server";
import { createAdminClient } from "@/lib/supabase/admin"; // existing service-role client in src/lib/supabase/admin.ts

const PATTERN = "/api/agent/checkout/[quoteId]/pay";

function quoteIdFromPath(path: string) {
  // /api/agent/checkout/<id>/pay
  return path.split("/")[4];
}

async function loadOpenQuote(quoteId: string) {
  const sb = createAdminClient();
  const { data: q } = await sb.from("quotes").select("*").eq("id", quoteId).single();
  if (!q || q.status !== "open" || new Date(q.expires_at) < new Date()) return null;
  return q as { id: string; total_cents: number; currency: "USD"; store_id: string; items: unknown };
}

const handler = async (req: NextRequest) => {
  // With paymentFlow "upfront", this only runs AFTER on-chain settlement succeeded.
  const quoteId = quoteIdFromPath(req.nextUrl.pathname);
  const sb = createAdminClient();

  // Idempotent: unique index on orders.quote_id
  const { data: order, error } = await sb
    .from("orders")
    .upsert({ quote_id: quoteId, status: "paid", payment_rail: "x402" }, { onConflict: "quote_id" })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 }); // note: already paid under upfront → reconcile manually

  await sb.from("quotes").update({ status: "paid" }).eq("id", quoteId);
  // Kick fulfilment: e.g. insert into fulfilment_jobs / call merchant adapter (place order on the real store)
  await sb.from("fulfilment_jobs").insert({ order_id: order.id, status: "queued" });

  return NextResponse.json({ orderId: order.id, status: "paid", fulfilment: "queued" });
};

export const POST = withX402(
  handler,
  {
    [PATTERN]: {
      accepts: {
        scheme: "exact",
        network: X402_NETWORK,
        payTo: PAY_TO,                      // or DynamicPayTo: per-merchant wallet
        maxTimeoutSeconds: 300,
        extra: { paymentFlow: "upfront" },  // settle BEFORE handler: never fulfil unpaid orders
        price: async (ctx) => {
          const quote = await loadOpenQuote(quoteIdFromPath(ctx.path));
          if (!quote) throw new Error("quote_not_payable"); // UNVERIFIED how SDK surfaces this: test it; alt: pre-check in a GET /quote/:id
          return `$${(quote.total_cents / 100).toFixed(2)}`;
        },
      },
      description: "ShoperZero checkout: pay cart quote",
      mimeType: "application/json",
      // unpaidResponseBody lets agents see the quote in the 402 body:
      unpaidResponseBody: async (ctx) => ({
        contentType: "application/json",
        body: { quoteId: quoteIdFromPath(ctx.path), hint: "Pay with x402 (USDC) and retry with PAYMENT-SIGNATURE" },
      }),
    },
  },
  x402,
);
```
Notes:
- **Upfront trust model:** if the handler fails after settlement, the buyer has already paid. Write the order row *first*, and keep the handler minimal and idempotent, so the worst case is a paid order stuck in `queued` that can be retried or refunded.
- The alternative is the default flow (no `paymentFlow`): the handler creates the order as `pending_payment`, `withX402` settles afterwards, and `x402.onAfterSettle` flips it to `paid` and enqueues fulfilment. That is more moving parts. Only choose it if upfront misbehaves on the testnet facilitator (**upfront + x402.org facilitator is UNVERIFIED end-to-end; test it first**).
- **Manual fallback** (no wrapper) is shown in [`examples/typescript/servers/custom`](https://github.com/x402-foundation/x402/blob/main/examples/typescript/servers/custom/index.ts): `x402.buildPaymentRequirements(cfg)`, then `await x402.createPaymentRequiredResponse(reqs, resourceInfo)` (it is `async` in 2.27, although the example omits `await`), then return 402 with a `PAYMENT-REQUIRED` base64 header. On retry, decode the `payment-signature` header, call `x402.verifyPayment(payload, req)`, then `x402.settlePayment(payload, req)`, and return with a `PAYMENT-RESPONSE` header. Use this if `withX402` fights us. It's roughly 40 lines.

### Agent-side client (demo buyer script / our agent runtime)
```ts
// Option A: raw key (simplest for demo). Fund with Base Sepolia USDC from https://faucet.circle.com
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const client = new x402Client();
client.setSpendControls({ maxAmountPerPayment: "$200" }); // guardrail for carts
client.register("eip155:*", new ExactEvmScheme(privateKeyToAccount(process.env.AGENT_PK as `0x${string}`)));
const pay = wrapFetchWithPayment(fetch, client);

const quote = await fetch(`${BASE}/api/agent/checkout/quote`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ storeId, items: [{ productId, variantId, qty: 1 }], shipping }),
}).then(r => r.json());

const res = await pay(`${BASE}/api/agent/checkout/${quote.quoteId}/pay`, { method: "POST" }); // handles 402 → sign → retry
const receipt = await new x402HTTPClient(client).processResponse(res); // decodes PAYMENT-RESPONSE
console.log(await res.json(), receipt);

// Option B: CDP managed wallet (no private key in env; spend caps built in)
import { CdpX402Client } from "@coinbase/cdp-sdk/x402";
const cdp = new CdpX402Client({ environment: "development", spendControls: { allowedNetworks: ["eip155:84532"] } });
const { evmAddress } = await cdp.getAddresses(); // fund this address
const pay2 = wrapFetchWithPayment(globalThis.fetch, cdp);
```
(Option B code is from [cdp-sdk examples](https://github.com/coinbase/cdp-sdk/blob/main/examples/typescript/x402/clients/payForApiWithSpendControls.ts). It needs `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`.)

---

## 5. MCP integration

`@x402/mcp` ([README](https://github.com/x402-foundation/x402/tree/main/typescript/packages/mcp)):
- Server: `createPaymentWrapper(resourceServer, { accepts, hooks })` wraps a tool handler. `accepts` is **pre-built** with `buildPaymentRequirements(...)`, so it's static per wrapper. A per-cart price would need you to build `accepts` inside each call. **UNVERIFIED** whether the wrapper accepts a function.
- Payment-required is signalled as an MCP JSON-RPC error with `x402Version` + `accepts` in `error.data` (codes per [specs/transports-v2/mcp.md](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/mcp.md)).
- Client: `createx402MCPClient({ schemes, autoPayment: true, onPaymentRequested })`.

**Recommendation:** keep MCP tools **free** (`search_products`, `get_product`, `create_quote`). Have `create_quote` return the `payUrl`, and let the agent pay over plain HTTP with `@x402/fetch`. Alternatively, a `checkout` MCP tool can call our own `/pay` endpoint server-side using the agent's wallet. This avoids per-call dynamic `accepts` inside MCP.

---

## 6. Discovery / Bazaar

- Add `extensions: { ...declareDiscoveryExtension({ input, inputSchema, output }) }` to a route. `withX402` auto-registers `bazaarResourceServerExtension`.
- The CDP facilitator indexes the endpoint after its first successful settlement **through CDP**, typically within about 10 minutes. The x402.org testnet facilitator does not feed the CDP Bazaar (**UNVERIFIED**).
- Public catalog (confirmed live, no auth): `GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources?limit=N` returns `{ items: [{ accepts, description, extensions.bazaar.info.input/output, resource … }] }`.
- Relevance: Bazaar indexes *paid endpoints*, not products. It's a nice "our checkout endpoint is discoverable by any x402 agent" bullet, but it's not our product index.

---

## 7. Ecosystem status (Sept 2026)

- **x402 Foundation:** launched under the Linux Foundation in 2026 (co-founded by Coinbase and Cloudflare). Members reportedly include AWS, Anthropic, Circle and Stripe. ([Cloudflare blog](https://blog.cloudflare.com/x402/), [Coinbase blog](https://www.coinbase.com/blog/coinbase-and-cloudflare-will-launch-x402-foundation), [InfoQ](https://www.infoq.com/news/2026/07/cloudflare-aws-x402-micropayment/))
- **Stripe:** x402 support on Base launched Feb 10, 2026. Docs: [docs.stripe.com/payments/machine/x402](https://docs.stripe.com/payments/machine/x402/quickstart). How it works:
  1. Create a Stripe crypto **deposit address** (`POST /v1/crypto/deposit_addresses`, `Stripe-Version: 2026-05-27.preview`, `network=base`) and use it as `payTo`.
  2. Settlement goes through the **CDP facilitator**.
  3. In `onAfterSettle`, create a PaymentIntent with `payment_method_options.crypto.mode = "transaction_verification"` and the tx hash, which gives you Stripe reporting, refunds and fiat payout.
  - Availability: all US states except New York, 30+ countries on request, live mode only, and access needs approval (Dashboard → Stablecoins and Crypto). Fee reported as 1.5%.
  - Stripe also has **MPP (Machine Payments Protocol)** for cards alongside stablecoins. That is covered in the Stripe/ACP track.
  - Takeaway: this is a good "production path" slide. It's likely not demo-able today unless someone already has an approved account.
- **Cloudflare:** its [Monetization Gateway](https://blog.cloudflare.com/monetization-gateway/) charges for pages, APIs and MCP tools via x402 at the edge, paid in stablecoins. It is **waitlist only**. Pay Per Crawl is moving to "pay per use" (July 2026). It isn't useful for our checkout. **NET Dollar:** no current status found (**UNVERIFIED**; skip it).
- **CDP facilitator:** networks are Base, Base Sepolia, Polygon, Arbitrum, World and World Sepolia (exact/upto/batch), plus Solana and Solana Devnet. 1,000 settlements per month free, then $0.001 each. ([docs](https://docs.cdp.coinbase.com/x402/core-concepts/facilitator))
- Other facilitators are listed at [x402.org/ecosystem?category=facilitators](https://www.x402.org/ecosystem?category=facilitators).

---

## 8. Recommendations for the hackathon build

1. **Rail:** x402 v2, `exact` scheme, **Base Sepolia (`eip155:84532`)**, USDC, facilitator `https://x402.org/facilitator`. No accounts or keys are needed on the server, only a `payTo` address.
2. **Endpoints** (all under `/api/agent/*`, outside the Supabase proxy matcher):
   - `POST /api/agent/checkout/quote` (free): validate items against our index, return `{quoteId, total, currency, expiresAt, payUrl}`.
   - `POST /api/agent/checkout/[quoteId]/pay` (x402): `withX402` with dynamic `price`, `paymentFlow: "upfront"`. It creates the order and enqueues fulfilment.
   - `GET /api/agent/orders/[id]` (free): status, tx hash, and a BaseScan link (`https://sepolia.basescan.org/tx/<hash>`).
3. **DB (Supabase migration, for the teammate):** `quotes(id uuid, store_id, items jsonb, subtotal_cents, shipping_cents, tax_cents, total_cents, currency, status enum[open,paid,expired], expires_at)`, `orders(id, quote_id unique, status, payment_rail, tx_hash, payer, network, created_at)`, `fulfilment_jobs(id, order_id, status, merchant_ref, error)`.
4. **Env vars:** `X402_NETWORK=eip155:84532`, `X402_FACILITATOR_URL=https://x402.org/facilitator`, `X402_PAY_TO=0x…`. The demo agent needs `AGENT_PK` (or `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`).
5. **Demo agent:** a Node script or our in-app agent using `@x402/fetch` with a funded Base Sepolia wallet (Circle faucet), with `setSpendControls({ maxAmountPerPayment })` set.
6. **Fulfilment:** ShoperZero receives the USDC as **merchant-of-record/proxy buyer**. The fulfilment job then places the order on the real non-Shopify store using that store's native checkout (Stripe/ACP track, a headless browser, or a virtual card), or marks it "manual" for the demo. Say this explicitly in the pitch.
7. **Stretch goals:** `declareDiscoveryExtension` on `/pay`; a `payment-identifier` extension; switching to the CDP facilitator plus `eip155:8453` for mainnet; Stripe `transaction_verification` in `onAfterSettle`; `auth-capture` as the future "refundable physical goods" story.

---

## 9. Open questions / risks

- **Dynamic price throwing:** how `withX402` responds when `price()` throws (500 vs 402) is **UNVERIFIED**. Guard with a pre-check or a clean error body.
- **Upfront flow on the testnet facilitator** has not been run end-to-end (**UNVERIFIED**). Fallback is the default flow plus `onAfterSettle`.
- **Merchant of record:** the real store doesn't accept x402, so we collect the funds and must buy on the agent's behalf. That raises refunds, chargebacks, tax, and pricing drift between quote and actual store checkout. Keep quotes short-lived and re-validate price and stock before accepting payment.
- **Refunds:** `exact` has no refund primitive. A refund is a manual USDC transfer back to `payer`. `auth-capture` fixes this but isn't on the free facilitator.
- **Agents need USDC wallets.** Card-holding agents need the Stripe ACP/SPT or MPP path, so offer both rails.
- **Serverless timeouts:** settlement waits for on-chain confirmation (roughly 1–3 s on Base). That's fine on Vercel, but don't do heavy fulfilment inline.
- **Route pattern mismatch** silently disables payment (only a warning is logged), so add a test that the unpaid call returns 402.
- `@coinbase/x402` vs `@coinbase/cdp-sdk/x402`: both work for the CDP facilitator. Stripe docs use the former and CDP docs the latter.

---

## Sources

- x402 repo (canonical): https://github.com/x402-foundation/x402 (mirror/legacy: https://github.com/coinbase/x402)
- v2 spec: https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md
- HTTP transport v2: https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md
- Schemes: https://github.com/x402-foundation/x402/tree/main/specs/schemes (exact, upto, auth-capture, batch-settlement)
- `@x402/next` README: https://github.com/x402-foundation/x402/blob/main/typescript/packages/http/next/README.md
- DynamicPrice/DynamicPayTo source: https://github.com/x402-foundation/x402/blob/main/typescript/packages/core/src/http/x402HTTPResourceServer.ts
- Next fullstack example: https://github.com/x402-foundation/x402/tree/main/examples/typescript/fullstack/next
- Custom (manual) server example: https://github.com/x402-foundation/x402/blob/main/examples/typescript/servers/custom/index.ts
- Upfront flow example: https://github.com/x402-foundation/x402/tree/main/examples/typescript/servers/upfront
- Fetch client example: https://github.com/x402-foundation/x402/blob/main/examples/typescript/clients/fetch/index.ts
- upto EVM README: https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/evm/src/upto/README.md
- Bazaar extension: https://github.com/x402-foundation/x402/blob/main/typescript/packages/extensions/src/bazaar/README.md
- `@x402/mcp`: https://github.com/x402-foundation/x402/tree/main/typescript/packages/mcp
- Testnet facilitator (live): https://x402.org/facilitator/supported
- V2 launch post: https://www.x402.org/writing/x402-v2-launch
- CDP facilitator: https://docs.cdp.coinbase.com/x402/core-concepts/facilitator
- CDP buyer/seller quickstarts: https://docs.cdp.coinbase.com/x402/quickstart-for-buyers , https://docs.cdp.coinbase.com/x402/quickstart-for-sellers
- CDP SDK Next example: https://github.com/coinbase/cdp-sdk/tree/main/examples/typescript/x402/servers/next
- Bazaar discovery API (live): https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources
- Stripe x402: https://docs.stripe.com/payments/machine/x402/quickstart ; The Block: https://www.theblock.co/post/389352/stripe-adds-x402-integration-usdc-agent-payments
- Cloudflare: https://blog.cloudflare.com/x402/ , https://blog.cloudflare.com/monetization-gateway/
- npm registry (versions checked): https://www.npmjs.com/package/@x402/next , https://www.npmjs.com/package/@coinbase/cdp-sdk
