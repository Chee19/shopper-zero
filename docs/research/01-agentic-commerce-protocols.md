# 01 — Agentic Commerce Protocol Landscape (as of 2026-09-26)

Track owner: research subagent. Audience: builders who start coding within the hour.
Everything here was checked against primary sources on 2026-09-26 unless marked **UNVERIFIED**.

---

## TL;DR

1. **Two checkout/catalog specs matter: UCP (Google + Shopify) and ACP (OpenAI + Stripe).** AP2, Visa TAP, Mastercard Agent Pay/Verifiable Intent and x402 are *payment-authorization or trust layers* that plug in underneath. They are not catalog or checkout APIs.
2. **UCP is the one to emulate first (primary).** It is the only spec with a standard **catalog search capability** (`dev.ucp.shopping.catalog` → `search_catalog`, `lookup_catalog`, `get_product`) *and* a standard **discovery file** (`/.well-known/ucp`). Shopify's Storefront Catalog MCP now implements it verbatim at `https://{shop}/api/ucp/mcp`. Our job is "make a non-Shopify store look like a UCP business", so this fits almost exactly. Spec version `2026-08-25`. https://ucp.dev/latest/specification/overview/ , https://shopify.dev/docs/agents/catalog/storefront-catalog
3. **ACP is the secondary target.** Stable `2026-04-17`. It has the **most widely known checkout shape** (`/checkout_sessions` create/update/complete/cancel, plus 5 MCP tools of the same names) and the **OpenAI product feed** (JSONL/CSV, 9 required fields). OpenAI still ingests feeds only from approved merchants via its merchant portal, so a feed does not get us into ChatGPT without an application. https://github.com/agentic-commerce-protocol/agentic-commerce-protocol , https://developers.openai.com/commerce/specs/feed
4. **ChatGPT's in-chat Instant Checkout effectively stalled.** Around 30 live Shopify merchants by Feb 2026. In March 2026 OpenAI moved to "discover in ChatGPT, buy on the merchant site", so ACP checkout inside ChatGPT is not a zero-glue path for us. Google AI Mode/Gemini (UCP) and Microsoft Copilot Checkout (PayPal/Shopify/Stripe) are the live in-agent checkout surfaces. https://www.cnbc.com/2026/03/20/open-ai-agentic-shopping-etsy-shopify-walmart-amazon.html
5. **For the "any agent, zero glue" path, Claude, Cursor and custom agents consume MCP.** Ship one MCP server exposing UCP tool names (`search_catalog`, `lookup_catalog`, `get_product`) plus checkout tools, and serve a UCP JSON profile at `/.well-known/ucp`. Mirror it as REST. Also emit an ACP-format `products.jsonl` for OpenAI-style consumers and "products.json"-style crawlers.
6. **Payments: use Stripe Shared Payment Tokens (SPT) as the demo rail.** Test helper `POST /v1/test_helpers/shared_payment/granted_tokens`, then `PaymentIntent` with `payment_method_data[shared_payment_granted_token]=spt_...`, header `Stripe-Version: 2026-04-22.preview`. SPT works as an ACP credential and as a UCP credential (`com.stripe.payments` handler, which is private preview). Add **x402** as a second handler for the crypto/"pay-per-call" story. x402 is now under the Linux Foundation's x402 Foundation.
7. **AP2 (v0.2, donated to FIDO Alliance, May 2026) is optional.** It adds signed mandates on top of UCP/A2A. Skip it for the hackathon, but put an `ap2` slot in the payment handler list so we can claim compatibility later.
8. **Trust layer: Visa TAP / Web Bot Auth (RFC 9421 signatures).** This is what stores and CDNs (Cloudflare) use to tell good agents from bots. Our crawler should send `Signature-Agent` / `Signature-Input` / `Signature` headers if we can register, or at least identify itself honestly. **Stretch goal.**

---

## Details

### 1. UCP — Universal Commerce Protocol (Google + Shopify)

- Announced NRF, 2026-01-11. Apache-2.0. Co-developers/endorsers include Etsy, Wayfair, Target, Walmart, Stripe, Adyen, PayPal. Live in Google AI Mode and the Gemini app with US retailers since around May 2026, and in Microsoft Copilot Checkout. https://developers.googleblog.com/under-the-hood-universal-commerce-protocol-ucp/ , https://shopify.engineering/UCP
- Spec: https://ucp.dev . GitHub org: https://github.com/Universal-Commerce-Protocol (repos `ucp`, `js-sdk`, `python-sdk`, `samples`, `conformance`, `ucp-schema`). **UNVERIFIED:** the exact npm package name of `js-sdk`. Check `package.json` in that repo before installing.
- Version string format is a date. Current: **`2026-08-25`**.

#### 1a. Discovery: `GET /.well-known/ucp` (business profile)

```json
{
  "ucp": {
    "version": "2026-08-25",
    "services": {
      "dev.ucp.shopping": [
        { "version": "2026-08-25", "spec": "https://ucp.dev/...", "schema": "https://ucp.dev/...",
          "transport": "rest", "endpoint": "https://shoperzero.app/s/{store}/ucp/v1" },
        { "version": "2026-08-25", "transport": "mcp", "endpoint": "https://shoperzero.app/s/{store}/ucp/mcp" }
      ]
    },
    "capabilities": {
      "dev.ucp.shopping.catalog":  [{ "version": "2026-08-25" }],
      "dev.ucp.shopping.checkout": [{ "version": "2026-08-25" }],
      "dev.ucp.shopping.order":    [{ "version": "2026-08-25" }]
    },
    "payment_handlers": {
      "com.stripe.payments": [{ "id": "stripe_payments", "version": "2026-06-25", "available_instruments": [{ "type": "card" }, { "type": "link" }], "config": { "environment": "sandbox", "merchant_id": "acct_...", "publishable_key": "pk_test_...", "credential_provider": "https://stripe.com/credential-provider/v1/" } }]
    }
  },
  "keys": [ /* JWK set for response signing (optional for hackathon) */ ]
}
```

- Required members: `ucp.version`, `ucp.services` (may be empty), `ucp.payment_handlers` (may be empty). `capabilities` and `keys` are optional.
- The exact nesting of `services` (keyed by service name, then an array of transports) is inferred from the service-declaration example. **Verify against the `ucp` repo schema** before shipping.
- Capabilities: `dev.ucp.shopping.checkout`, `.cart`, `.order`, `.catalog` (with sub-ops `.catalog.search` and `.catalog.lookup`), `dev.ucp.common.identity_linking`. Extensions use `"extends": "dev.ucp.shopping.checkout"` (for example `dev.ucp.shopping.fulfillment`).
- Transports: `rest` (OpenAPI 3), `mcp` (OpenRPC), `a2a` (Agent Card), `embedded`.
- The agent identifies itself via the header `UCP-Agent: profile="https://agent.example/profile.json"` (RFC 8941 dictionary). Over MCP it sends `arguments.meta["ucp-agent"].profile`. Capability negotiation picks the intersection of both profiles at the highest mutual version.
- Every response carries a `ucp` envelope: `{ "ucp": { "version": "...", "capabilities": {...} }, ... }`.

#### 1b. Catalog (the core of our "index")

REST (https://ucp.dev/latest/specification/shopping/catalog/rest/). Headers: `Request-Id`, `UCP-Agent`, and optionally `Authorization` / `X-API-Key` / RFC 9421 `Signature`.

| Op | REST | MCP tool |
|---|---|---|
| Search | `POST /catalog/search` | `search_catalog` |
| Batch lookup | `POST /catalog/lookup` | `lookup_catalog` |
| Product detail + variant selection | `POST /catalog/product` | `get_product` |

Search request:
```json
{ "query": "blue running shoes",
  "context": { "address_country": "US", "address_region": "CA", "language": "en", "currency": "USD" },
  "filters": { "categories": ["Footwear"], "price": { "max": 15000 } },
  "pagination": { "limit": 20, "cursor": "..." } }
```
Search response: `{ "ucp": {...}, "products": [Product], "pagination": { "cursor", "has_next_page", "total_count" }, "messages": [...] }`

Lookup request: `{ "ids": ["prod_abc123"], "context": {...} }`. Shopify caps this at 10 ids.
Product request: `{ "id": "prod_abc123", "selected": [{"name":"Color","label":"Blue"}], "preferences": ["Color","Size"], "context": {...} }`. The response includes `product.options[].values[] { label, available, exists }`.

MCP args are wrapped: `{ "meta": { "ucp-agent": { "profile": "..." } }, "catalog": { ...same body... } }`. Results come back in `structuredContent`.

**Product** (https://ucp.dev/latest/specification/shopping/catalog/):
`id`*, `handle`, `title`*, `description`* (object, e.g. `{ "plain": "..." }`, may also carry html/markdown), `url`, `categories[]`, `price_range`* `{min,max}`, `list_price_range`, `media[]` (first = featured), `options[]`, `variants[]`*, `rating`, `tags[]`, `metadata`

**Variant**: `id`*, `sku`, `barcodes[]`, `handle`, `title`*, `description`*, `url`, `categories[]`, `price`*, `list_price`, `unit_price`, `quantity_unit`, `availability` (`{ "available": true }`), `options[]` (selected), `media[]`, `rating`, `tags[]`, `metadata`, `seller`

**Price**: `{ "amount": <integer minor units>, "currency": "USD" }` (* = required)

#### 1c. Checkout (UCP REST binding)

https://ucp.dev/latest/specification/shopping/checkout/rest/

| Op | Method + path |
|---|---|
| Create | `POST /checkout-sessions` (201) |
| Get | `GET /checkout-sessions/{id}` |
| Update | `PUT /checkout-sessions/{id}` (**full replacement**) |
| Complete | `POST /checkout-sessions/{id}/complete` |
| Cancel | `POST /checkout-sessions/{id}/cancel` |

- Headers: `UCP-Agent`, `Idempotency-Key` (cached 24h), `Request-Id`, `Content-Type: application/json`. Optional auth and signatures as above.
- Create body: `{ "line_items": [{ "item": {"id": "item_123"}, "quantity": 2 }], "buyer"?: {...}, "currency"?: "USD" }`
- Response fields: `ucp` (includes negotiated `payment_handlers`), `id`, `status`, `messages[]`, `currency`, `line_items[] { id, item {id,title,price}, quantity, totals[] }`, `totals[] {type, amount}`, `links[] {type,url}` (e.g. `terms_of_service`), `payment.instruments[]`, `continue_url`, `order` (when completed), `buyer`.
- Status enum: `incomplete`, `requires_escalation`, `ready_for_complete`, `complete_in_progress`, `completed`, `canceled`.
- `requires_escalation` means handing off to a human via `continue_url`. **This is our escape hatch for stores we can't transact against headlessly.** Return `continue_url` = the store's own cart/checkout URL.
- Messages: `{ type: error|warning|info, code, path (JSONPath e.g. $.buyer.email), content, severity: recoverable|requires_buyer_input|requires_buyer_review|unrecoverable }`. Business errors return HTTP 200 plus messages.
- Complete body:
```json
{ "payment": { "instruments": [{ "id": "instr_1", "handler_id": "stripe_payments", "type": "card", "selected": true,
  "display": { "brand": "visa", "last_digits": "4242" },
  "credential": { "type": "stripe_payment_token", "token": "spt_... or tok_...", "expires_at": "..." } }] } }
```
- MCP tool names for UCP checkout and cart: **UNVERIFIED.** They are likely `create_checkout`, `get_checkout`, `update_checkout`, `complete_checkout` and `cancel_checkout`; see `ucp.dev/latest/specification/shopping/checkout/mcp/`.

#### 1d. Payment handlers (UCP)

- `com.google.pay` (spec https://pay.google.com/gp/p/ucp/2026-01-11/), `dev.shopify.shop_pay` / `com.shopify.shop_pay`, `com.stripe.payments` (**private preview**, https://docs.stripe.com/agentic-commerce/ucp/stripe-payments-handler.md).
- With the Stripe handler, the platform tokenizes via `POST https://ucp.stripe.com/handlers/payments/tokenize`, sends the token in `/complete`, and the business charges it via a PaymentIntent (`payment_method_data[card][token]=tok_...` or `payment_method_data[shared_payment_granted_token]=spt_...`).
- No official x402 UCP handler found. **UNVERIFIED.** We can define our own vendor handler, e.g. `app.shoperzero.x402`, because reverse-domain vendor handlers are allowed by the spec.

### 2. ACP — Agentic Commerce Protocol (OpenAI + Stripe)

- Repo: https://github.com/agentic-commerce-protocol/agentic-commerce-protocol . Versions: 2025-09-29, 2025-12-12, 2026-01-16 (capability negotiation), 2026-01-30 (extensions, discounts, payment handlers), **2026-04-17 (stable: cart, feed, orders, delegate authentication/3DS, MCP binding)**.
- OpenAPI: `spec/2026-04-17/openapi/openapi.agentic_checkout.yaml`, `openapi.delegate_payment.yaml`. JSON Schemas: `spec/2026-04-17/json-schema/`.
- Merchant-facing docs: https://developers.openai.com/commerce/specs/checkout (these still show the older, simpler 2025 shape) and https://docs.stripe.com/agentic-commerce/acp

#### 2a. Checkout endpoints (merchant implements)

| Op | Method + path | Code |
|---|---|---|
| Create | `POST /checkout_sessions` | 201 |
| Update | `POST /checkout_sessions/{id}` | 200 |
| Get | `GET /checkout_sessions/{id}` | 200/404 |
| Complete | `POST /checkout_sessions/{id}/complete` | 200 |
| Cancel | `POST /checkout_sessions/{id}/cancel` | 200/405 |

- Headers: `Authorization: Bearer <key>`, `Content-Type`, `Idempotency-Key` (mandatory on all POSTs since 2026-04-17), `API-Version` (e.g. `2026-04-17`; the YAML lists `2026-01-16` as the minimum), plus `Request-Id`, `Accept-Language`, `User-Agent`, `Signature`, `Timestamp` (from OpenAI docs).
- Note the path style: ACP uses `checkout_sessions` (underscore) and **POST** for update. UCP uses `checkout-sessions` (hyphen) and **PUT**. The two are easy to serve side by side from the same handler.
- MCP binding (2026-04-17): tools `create_checkout_session`, `get_checkout_session`, `update_checkout_session`, `complete_checkout_session`, `cancel_checkout_session`.
- New in 2026-04-17: carts (`POST /carts`, `GET /carts/{id}`, `PUT /carts/{id}`, `POST /carts/{id}/cancel`) and a Feed API (`POST /feeds`, `GET /feeds/{id}`, `GET /feeds/{id}/products`, `PATCH /feeds/{id}/products`, with products as `products.jsonl`). Breaking changes: `quantity` is now a decimal number, and `request_not_idempotent` was removed.

**Create request (2026-04-17):** `buyer`, `line_items[]` (Item: `id`*, `name`, `unit_amount`) + quantity, `currency`, `fulfillment_details`, `affiliate_attribution`, `discounts`.
Older, simpler form (still in OpenAI docs): `{ items: [{id, quantity}], buyer?: {name,email,phone_number}, fulfillment_address?: {name,line_one,line_two,city,state,country,postal_code,phone_number} }`

**Update request:** `buyer`, `line_items[]`, `fulfillment_details`, `selected_fulfillment_options[]`, `discounts`, `marketing_consents[]`

**CheckoutSession response:** `id`, `protocol`, `capabilities` (`payment.handlers[]`, `interventions`, `extensions`), `buyer`, `status`, `currency`, `presentment_currency`, `exchange_rate`, `locale`, `timezone`, `line_items[]`, `fulfillment_details`, `fulfillment_options[]`, `selected_fulfillment_options[]`, `fulfillment_groups[]`, `totals[]`, `messages[]`, `links[]`, `authentication_metadata`, `created_at`, `updated_at`, `expires_at`, `continue_url`, `metadata`, `quote_id`, `quote_expires_at`, `marketing_consent_options[]`, `discounts`, and `order` once completed.

- LineItem: `id, item, quantity, name, description, images[], unit_amount, disclosures[], custom_attributes[], marketplace_seller_details, product_id, sku, variant_id, category, tags[], weight, dimensions, availability_status, available_quantity, max_quantity_per_order, fulfillable_on, variant_options[], discount_details[], tax_exempt, tax_exemption_reason, parent_id, totals[]`
- Total: `{ type, display_text*, amount* (minor units), presentment_amount, description, breakdown[] }`. Types: `items_base_amount, items_discount, subtotal, discount, fulfillment, tax, fee, gift_wrap, tip, store_credit, total, amount_refunded`
- FulfillmentOption: `type` (shipping | pickup | local_delivery | digital), `id`, `title`, `description`, `totals[]`. Shipping adds `carrier, earliest_delivery_time, latest_delivery_time`.
- Messages: `info | warning | error`, with `code` (e.g. `missing, invalid, out_of_stock, payment_declined, requires_3ds, intervention_required, ...`), `severity`, `resolution`, `param`, `content_type`, `content`.
- Status enum (2026-04-17): `incomplete, not_ready_for_payment, requires_escalation, authentication_required, ready_for_payment, pending_approval, complete_in_progress, completed, canceled, in_progress, expired`. The minimum used in the old docs: `not_ready_for_payment, ready_for_payment, completed, canceled`.

**Complete request:** `buyer`, `payment_data { handler_id, instrument { type, credential { type, token } }, billing_address, purchase_order_number, payment_terms, due_date, approval_required }`, `affiliate_attribution`, `marketing_consents[]`
Old form: `payment_data { token: "spt_...", provider: "stripe", billing_address? }`

**Order:** `type:"order", id, checkout_session_id, order_number, permalink_url, status (created|confirmed|manual_review|processing|shipped|completed|canceled), estimated_delivery, confirmation, support, line_items[], fulfillments[], adjustments[], totals[]`

**Webhooks (merchant → agent):** `{ type: "order_created"|"order_updated", data: { type:"order", checkout_session_id, permalink_url, status, refunds[] } }`, HMAC signed.

#### 2b. OpenAI product feed spec (https://developers.openai.com/commerce/specs/feed)

Formats: **JSONL**, CSV, TSV (optionally `.gz`), or a Google-Merchant-compatible TSV/CSV. Plain JSON and XML are **not** supported. Delivery is push (SFTP/upload) after approval at https://chatgpt.com/merchants , with refreshes as often as every 15 minutes (secondary source).

Required (9): `item_id`, `title` (≤150), `description` (≤5000), `url`, `brand`, `seller_name`, `image_url`, `availability` (`in_stock|out_of_stock|pre_order|backorder|unknown`), `price` (`"79.99 USD"`).

Optional: `is_eligible_search` (default true), `is_eligible_checkout`, `group_id`, `listing_has_variations`, `variant_dict`, `offer_id`, `gtin`, `mpn`, `condition` (`new|refurbished|used`), `product_category` (`A > B > C`), `material`, `color`, `size`, `size_system`, `gender`, `age_group`, `dimensions`/`length`/`width`/`height`/`dimensions_unit`, `weight`/`item_weight_unit`, `additional_image_urls`, `sale_price`, `shipping_price`, `shipping` (`country:region:service_class:price`), `accepts_returns`, `return_deadline_in_days`, `return_policy`, `accepts_exchanges`, `review_count`, `star_rating`, `store_review_count`, `store_star_rating`, `marketplace_seller`, `is_digital`, `target_countries`, `store_country`, `is_ads_eligible`, `ads_metadata`, `seller_privacy_policy`, `seller_tos`, `seller_url`.

Conventions: UTF-8, absolute URLs, IDs as strings, and omit unknown fields (never write `"null"`). **The feed is flat, one row per variant, with string money.** UCP is nested, integer minor units. Our DB should store the UCP shape and render the ACP feed from it.

### 3. AP2 — Agent Payments Protocol (Google)

- v0.2 (April 2026). Contributed to the **FIDO Alliance** on 2026-05-26 together with Mastercard Verifiable Intent. Repo https://github.com/google-agentic-commerce/AP2 (Python SDK via `uv pip install git+https://github.com/google-agentic-commerce/AP2.git@main`; samples in Python, Go and Android). Docs https://ap2-protocol.org/
- Mandates are signed verifiable credentials. The v0.1 names are **IntentMandate** (user's constraints, used for human-not-present), **CartMandate** (merchant-signed cart the user approves) and **PaymentMandate** (shared with network/issuer). The v0.2 docs reframe these as **Checkout Mandate** and **Payment Mandate**, each with *open* (constraints) and *closed* (final) stages. **UNVERIFIED:** exact v0.2 field names.
- Roles: shopping agent, merchant endpoint, credentials provider, payment processor. Runs as an A2A extension. Integrates with UCP. An A2A x402 extension exists for stablecoin settlement.
- **Verdict:** skip it for the hackathon. Mention it as roadmap.

### 4. Payment and trust rails (under the protocols)

| Rail | What it is | Use for us |
|---|---|---|
| **Stripe SPT** (Agentic Commerce Suite, Dec 2025) | Agent-issued, scoped, single-use grant of a buyer's payment method to a seller. US, CA and many EU countries. Preview ToS. | **Primary demo rail.** Test: `curl https://api.stripe.com/v1/test_helpers/shared_payment/granted_tokens -H "Stripe-Version: 2026-04-22.preview" -d payment_method=pm_card_visa -d "usage_limits[currency]=usd" -d "usage_limits[max_amount]=1000" -d "usage_limits[expires_at]=..."`, then `POST /v1/payment_intents amount=… currency=usd payment_method_data[shared_payment_granted_token]=spt_… confirm=true`. Webhook `shared_payment.granted_token.deactivated`. https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens |
| **Stripe link-cli / Agent Wallet** | The buyer-side agent creates a "spend request". The user approves in the app and gets an SPT, a one-time virtual card, or a pay token. `npx @stripe/link-cli ...`. Stripe docs now brand Link as "Onelink" (**UNVERIFIED** rebrand, possibly a docs template artifact). Mentions a "Machine Payments Protocol (MPP)" (**UNVERIFIED** details). | Good for the demo *buyer* side and for live-mode SPT tests. https://docs.stripe.com/agentic-commerce/link-cli/commerce-agents-ucp |
| **x402** | HTTP 402 plus stablecoin (USDC) settlement. Coinbase donated it to the Linux Foundation's x402 Foundation on 2026-04-02. | Secondary handler: "the agent pays for the order, or for premium index access, per call". Covered in the payments track doc. |
| **Visa Intelligent Commerce / Trusted Agent Protocol** | Agent identity via RFC 9421 HTTP Message Signatures on Web Bot Auth. Headers `Signature-Agent`, `Signature-Input` (tag `agent-browser-auth` or `agent-payer-auth`), `Signature`. Ed25519 keys in a Visa directory. Launched with Cloudflare, Stripe, Shopify, Adyen and others. https://github.com/visa/trusted-agent-protocol | Crawler identity and anti-bot passage (stretch goal). We could *verify* TAP signatures on our checkout API. |
| **Mastercard Agent Pay** | Agentic tokens scoped by agent, merchant, amount and time. Verifiable Intent (2026-03-05) records what the user authorized. Now at FIDO. | Nothing to build. Mention it in the pitch. |
| **PayPal** | Powers Perplexity Instant Buy (Nov 2025) and Microsoft Copilot Checkout (Jan 2026). Also an ACP-compliant payment server for ChatGPT. | Skip for the hackathon. |

### 5. Surfaces and who consumes what

| Agent surface | Discovery input | Checkout path | Open to us without partnership? |
|---|---|---|---|
| Google AI Mode / Gemini | Merchant Center feed + UCP profile | UCP (native) | No. Needs Merchant Center and Google onboarding. |
| ChatGPT | ACP product feed (approved merchants), web search, Apps SDK/MCP | Mostly **buy on merchant site** since Mar 2026. ACP Instant Checkout is limited. | Feed: no (application). MCP app: yes, via ChatGPT developer mode or Apps. |
| Microsoft Copilot | Shopify/PayPal/Stripe partner feeds; NLWeb for sites | Copilot Checkout (PayPal/Stripe/Shopify) | No. |
| Perplexity | Merchant catalogs via PayPal | Instant Buy (PayPal) | No. |
| Amazon Rufus "Buy for Me" | Crawls third-party brand sites | Agentic browser checkout (Nova + Claude) | N/A. This is the "scrape and drive the site" approach we compete with. |
| **Claude / Cursor / custom agents** | **MCP servers** | Whatever the MCP exposes | **Yes. This is the zero-glue path for us.** |
| Shopify's own agents | `/api/ucp/mcp` per store, Global Catalog MCP | UCP checkout / Checkout Kit | N/A (Shopify-only) |

---

## Concrete recommendations for our hackathon build

**Primary spec: UCP `2026-08-25`** for catalog and discovery, and for checkout shape. **Secondary spec: ACP `2026-04-17`** for the product feed export and the checkout endpoint aliases plus MCP tool names.

1. **Canonical data model = UCP Product/Variant** (integer minor units, `price_range`, `variants[]`, `options[]`, `media[]`, `availability.available`). Store the raw scraped JSON too. In Supabase, key products by `store_id + source_product_id`, with a `gid`-like id such as `sz:{store_slug}:product:{id}`.
2. **Per-store discovery file:** `GET /s/{store}/.well-known/ucp`. Store owners who adopt us can also host a redirect or proxy at their own domain root, and serving it from their domain is the real endgame. Declare `dev.ucp.shopping.catalog` and `dev.ucp.shopping.checkout`, the REST and MCP endpoints, and payment handlers (`com.stripe.payments`-shaped entry pointing at our Stripe test account, plus a vendor `app.shoperzero.x402`).
3. **Catalog REST** (Next.js route handlers): `POST /s/{store}/ucp/v1/catalog/search`, `/catalog/lookup`, `/catalog/product`. Search can be Postgres full-text search (`tsvector`) plus optional pgvector later. Cursor pagination.
4. **One MCP server** (`/api/mcp`, streamable HTTP) with tools named exactly **`search_catalog`, `lookup_catalog`, `get_product`**, taking the UCP `{ meta, catalog: {...} }` args. Add an optional `store` or `business` argument so one endpoint serves the whole cross-store index, like Shopify's Global Catalog. Add checkout tools named per **ACP's MCP binding** (`create_checkout_session`, `update_checkout_session`, `complete_checkout_session`, `get_checkout_session`, `cancel_checkout_session`), because those names are verified and self-explanatory.
5. **Flat export for crawlers and OpenAI:** `GET /s/{store}/products.jsonl` in the **ACP/OpenAI feed format** (9 required fields, one row per variant). Also offer `GET /s/{store}/products.json` in a **Shopify-compatible shape** (`{ products: [{ id, title, handle, body_html, vendor, product_type, tags, variants[{id,title,price,sku,available}], images[{src}], options[] }] }`). Existing agents and scrapers already know how to read Shopify's format, so this is the literal "products.json for everyone" pitch.
6. **Checkout API:** implement one handler and mount it at both `POST /s/{store}/checkout-sessions` (UCP, PUT update) and `POST /s/{store}/checkout_sessions` (ACP, POST update). Minimum viable statuses: `incomplete` → `ready_for_complete` (UCP) / `ready_for_payment` (ACP) → `completed` | `canceled` | `requires_escalation`.
   - **Tier A (demo, reliable):** we are the merchant of record for a demo store, or a store that connected its Stripe account. On `/complete`, charge an SPT via PaymentIntent, then create the order in the store (WooCommerce REST `POST /wp-json/wc/v3/orders` with `set_paid: true`, if we have keys).
   - **Tier B (any store, honest fallback):** return `status: requires_escalation` with `continue_url` = a prefilled store cart URL (e.g. WooCommerce `/?add-to-cart={id}&quantity=n`, or a BigCommerce `/cart.php?action=add&product_id=`). This is what ChatGPT itself now does, so it's defensible.
   - **Tier C (stretch):** headless browser checkout with a one-time virtual card from Stripe link-cli.
7. **Always return `messages[]` with `severity`** and `totals[]` using the shared type vocabulary (`subtotal`, `tax`, `fulfillment`, `total`). Both specs use nearly identical totals, so one implementation covers both.
8. **Headers:** accept and ignore `UCP-Agent`, require `Idempotency-Key` on POST (store key → response in Supabase for 24h), echo `Request-Id`, and send an `API-Version` / `ucp.version` envelope.
9. **Skip:** AP2 mandates, identity linking/OAuth, the ACP delegate-authentication (3DS) API, response signing (`keys`), cart capability (checkout-with-line-items is enough), and ACP Feed API push endpoints.

---

## Open questions / risks

- **Merchant-of-record and legal:** checking out on behalf of stores we don't partner with means we're not the merchant, and an SPT is granted to a Stripe *seller profile*. Headless SPT checkout therefore only works for stores that connect Stripe to us. For the demo, use our own demo store or a connected WooCommerce test store.
- **UCP MCP checkout tool names and the exact `services` nesting** are UNVERIFIED. Read `https://ucp.dev/latest/specification/shopping/checkout/mcp/` and the `ucp` repo JSON Schemas before finalizing.
- **Spec churn:** UCP moved from 2026-01-11 → 2026-01-23 → 2026-04-08 → 2026-08-25 in 8 months, and ACP has shipped 5 versions. Pin versions in the envelope.
- **`com.stripe.payments` UCP handler is private preview.** Use the raw SPT test helper plus our own handler entry instead.
- **ChatGPT distribution:** the feed requires an approved merchant application, so we can't claim "appears in ChatGPT". We can claim "ACP-feed-compatible" and "works in ChatGPT via MCP/Apps developer mode".
- **Anti-bot:** many stores sit behind Cloudflare, where "AI crawl control" and Web Bot Auth are on by default for many zones. Scans may get blocked. Consider Web Bot Auth signing (see the crawler track).
- Secondary-source claims (Instant Checkout's ~30 merchants, x402 volume, UCP retail live dates) come from news or analyst sites. Treat the numbers as approximate.

---

## Sources

UCP
- https://ucp.dev/latest/specification/overview/
- https://ucp.dev/latest/specification/shopping/catalog/ and https://ucp.dev/latest/specification/shopping/catalog/rest/ and https://ucp.dev/latest/specification/shopping/catalog/mcp/
- https://ucp.dev/latest/specification/shopping/checkout/ and https://ucp.dev/latest/specification/shopping/checkout/rest/
- https://ucp.dev/latest/specification/payment-handler-guide/
- https://github.com/Universal-Commerce-Protocol
- https://developers.googleblog.com/under-the-hood-universal-commerce-protocol-ucp/
- https://shopify.engineering/UCP
- https://shopify.dev/docs/agents/catalog/storefront-catalog , https://shopify.dev/docs/agents/catalog/global-catalog , https://shopify.dev/changelog/storefront-catalog-mcp-now-implements-ucp
- https://pay.google.com/gp/p/ucp/2026-01-11/ (Google Pay handler)

ACP / OpenAI
- https://github.com/agentic-commerce-protocol/agentic-commerce-protocol (spec/2026-04-17, changelog/2026-04-17.md)
- https://raw.githubusercontent.com/agentic-commerce-protocol/agentic-commerce-protocol/main/spec/2026-04-17/openapi/openapi.agentic_checkout.yaml
- https://developers.openai.com/commerce/specs/checkout
- https://developers.openai.com/commerce/specs/feed
- https://chatgpt.com/merchants/
- https://openai.com/index/buy-it-in-chatgpt/
- https://www.cnbc.com/2026/03/20/open-ai-agentic-shopping-etsy-shopify-walmart-amazon.html

Stripe
- https://docs.stripe.com/agentic-commerce/acp
- https://docs.stripe.com/agentic-commerce/protocol
- https://docs.stripe.com/agentic-commerce/ucp/stripe-payments-handler.md
- https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens
- https://docs.stripe.com/agentic-commerce/link-cli/commerce-agents-ucp
- https://stripe.com/blog/agentic-commerce-suite

AP2 / networks / trust
- https://ap2-protocol.org/ , https://github.com/google-agentic-commerce/AP2
- https://github.com/visa/trusted-agent-protocol , https://developer.visa.com/capabilities/trusted-agent-protocol/trusted-agent-protocol-specifications
- https://blog.cloudflare.com/secure-agentic-commerce/
- https://www.mastercard.com/us/en/news-and-trends/stories/2026/verifiable-intent.html

Other surfaces
- https://newsroom.paypal-corp.com/2026-01-08-PayPal-Powers-Microsofts-Launch-of-Copilot-Checkout
- https://newsroom.paypal-corp.com/2025-11-PayPal-and-Perplexity-Launch-Instant-Buy
- https://www.aboutamazon.com/news/retail/amazon-shopping-app-buy-for-me-brands
