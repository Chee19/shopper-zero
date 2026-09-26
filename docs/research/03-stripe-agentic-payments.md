# 03 — Stripe for AI agents / agentic payments (state as of 2026-09-26)

Scope: which Stripe primitives ShoperZero can use for the **checkout** half of the product, given that we do **not** control the target merchant's Stripe account. Everything below was checked against docs.stripe.com on 2026-09-26 unless marked **UNVERIFIED**.

---

## TL;DR

- **The Stripe primitive for agent payments is the Shared Payment Token (SPT, `spt_*`).** An agent turns a buyer's PaymentMethod into a token scoped to one seller (`profile_*`), with a max amount and an expiry. The seller charges it with a normal `PaymentIntent` (`payment_method_data[shared_payment_granted_token]=spt_…`). Preview API version: `2026-04-22.preview`. Seller-side test helper: `POST /v1/test_helpers/shared_payment/granted_tokens`. ([SPT docs](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens))
- **SPTs only help when the *seller* is on Stripe and willing to redeem them.** Arbitrary non-Shopify stores won't be, so for "buy from any store" the working Stripe option is a **card credential**. That means either a Stripe **Issuing** virtual card that we own (Issuing for agents, *preview*; live needs an Issuing application) or a **Onelink (formerly Link) Agent Wallet** one-time card that the *user* approves (`@stripe/link-cli`, available now to US and Canadian consumers). Our agent then types that card into the store's normal checkout.
- **Recommended hackathon path: (A) intermediary.** The agent pays **us** (MPP/SPT or Checkout Session). We then pay the store with a **single-use Issuing virtual card** whose limits are locked to that order, and use real-time auth webhooks as a guardrail. Everything except the external purchase works in a **sandbox**. Test Issuing cards "can only be used within your Stripe account and not for external purchases" ([Issuing testing](https://docs.stripe.com/issuing/testing.md?testing-method=with-code)), so the demo simulates the store authorization with `test_helpers/issuing/authorizations`.
- **The fastest real-world "pay at any store" demo is Onelink Agent Wallet.** `link-cli spend-request create --test …` returns a test card (`4000009990001984`) with no Stripe account needed. Live mode needs the user's own approval in the Onelink app, which is also a good demo moment.
- **(B) Merchant onboarding via Connect + SPT** is the long-term "make stores agent-ready" story. It is doable in test mode in about 3–5 h if we expose our own ACP-style checkout endpoints and use destination charges with our platform profile. Stripe's managed "Agentic commerce for platforms" (catalog import on behalf of connected accounts) is **US-only and waitlist-gated**, so skip it for the hackathon.
- **MPP (Machine Payments Protocol, Stripe + Tempo) is the easiest way for an agent to pay *us*.** Setup is `npm i mppx stripe`, then about 20 lines for a 402-challenge endpoint that accepts SPTs (cards) and Tempo stablecoins. It works in a sandbox (Tempo testnet), and you validate it with `npx mppx@latest validate`. ([MPP](https://docs.stripe.com/payments/machine/mpp.md))
- **x402 via Stripe works but is hard to demo.** It records settled Base USDC payments as PaymentIntents (`crypto` + `transaction_verification`, API `2026-05-27.preview`). It needs the "Stablecoins and Crypto" payment method approved, a CDP facilitator account, and, per the docs example, **live funds**. Use MPP on Tempo testnet for the Stripe-stablecoin demo, and leave pure x402 (Base Sepolia) to the x402 track.
- **Agent-side ACS (Delegated Checkout `RequestedSession`, product feeds over SFTP) is private preview/waitlist.** Skip it. **Order Intents** (Stripe's "buy from any retailer" API) is also private preview, and its docs URL now returns 404, so skip it too.

---

## Details

### 1. Landscape (what exists, status)

| Product | What it is | Status (Sept 2026) | Useful to us? |
|---|---|---|---|
| **Shared Payment Tokens** | Seller-scoped, amount- and time-limited grant of a buyer's PaymentMethod | Available (US, CA, ~30 EU countries). Preview API `2026-04-22.preview`. Preview ToS | Yes: accepting agent payments (pay-in) |
| **Agentic Commerce Suite (ACS), seller side** | Merchant uploads a CSV catalog to Stripe and is syndicated to ChatGPT, Copilot, Gemini (UCP), Meta. Orders arrive as `checkout.session.completed` | GA for sellers ([for-sellers](https://docs.stripe.com/agentic-commerce/for-sellers.md)). Catalog API `v2/commerce/product_catalog/imports`, `2026-08-26.preview` | Maybe: "export our index to Stripe" for merchants who are already on Stripe |
| **ACS, agent side (Delegated Checkout)** | `POST /v1/delegated_checkout/requested_sessions` → confirm → Stripe mints the SPT and routes it to the seller | **Private preview / waitlist** ([for-agents](https://docs.stripe.com/agentic-commerce/for-agents.md?agent-checkout-mode=full)) | No (gated) |
| **ACS for platforms (Connect)** | Platform uploads catalogs per connected account, with `customize_checkout` and `finalize_checkout` hooks | **US, waitlist** ([SaaS guide](https://docs.stripe.com/connect/saas/tasks/enable-in-context-selling-on-ai-agents.md)) | No (gated) |
| **ACP** | Open protocol (Stripe, OpenAI, Meta): checkout sessions, feed, delegate payment, delegate auth, order webhooks. Spec version `2026-04-17` | Open spec ([agenticcommerce.dev](https://agenticcommerce.dev), [GitHub](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol)) | Yes: shape of the API we expose per store |
| **UCP** | Google's Universal Commerce Protocol. Stripe exposes a `com.stripe.payments` handler | Coming or partial ([UCP handler](https://docs.stripe.com/agentic-commerce/ucp/stripe-payments-handler.md)) | Later |
| **MPP** | HTTP 402 protocol (Stripe + Tempo). Accepts SPT (cards) and stablecoins | Available. `mppx` npm | Yes: agent pays us |
| **x402 on Stripe** | x402 (Coinbase) with USDC on Base, Tempo or Solana, recorded as a Stripe PaymentIntent | Available with approval. US (not NY) plus 30+ countries on request | Optional |
| **Issuing for agents** | Virtual cards with spend controls, real-time auth and single-use lifecycle | **Preview**. Issuing needs an application for live. Sandbox works | Yes: we pay the store |
| **Issuing card → PaymentMethod → SPT** | Fund SPT/MPP/UCP purchases from an Issuing card without exposing the PAN | **Private preview** (`card[issuing_card]` rejected without access) | No (gated) |
| **Onelink Agent Wallet** (Link was renamed Onelink) | Consumer OAuth wallet. Agent creates a "spend request", the user approves, and the agent gets a one-time card, SPT or Onelink Pay Token | Available to **US and Canadian consumers** ([docs](https://docs.stripe.com/agentic-commerce/link-agent-wallet.md)) | Yes: real "pay anywhere" |
| **Stripe MCP** | Remote MCP at `https://mcp.stripe.com` (OAuth or Agent keys) | Available | Dev tooling and the dashboard agent |
| **@stripe/agent-toolkit** | Stripe tools for LangChain, Vercel AI SDK and others | v0.9.0 on npm (breaking changes since 0.8.x) | Optional |
| **Order Intents** | "Buy from any retailer" API (browser automation, direct integrations, human fallback) | **Private preview**. Docs URL 404s | No |
| **Agent guardrails / Agent keys / Radar bot abuse** | Agent identities, approvals, agent-vs-bot detection | Preview | Mention only |

Network tokens: when Stripe processes SPT card payments it may use **Visa Intelligent Commerce** and **Mastercard Agent Pay** tokens on your behalf ([SPT docs, footnote](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens.md?agent-seller=agent)). No separate integration is needed.

### 2. Shared Payment Tokens: concrete API

**Agent side: issue an SPT to a seller** ([agent tab](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens.md?agent-seller=agent))

1. Collect a PaymentMethod with the Payment Element, using `paymentMethodCreation: 'manual'` and `sellerDetails.networkBusinessProfile`, then `stripe.preparePaymentMethod({elements})`.
2. Issue the token:

```bash
curl https://api.stripe.com/v1/shared_payment/issued_tokens \
  -u "$STRIPE_SECRET_KEY:" \
  -H "Stripe-Version: 2026-04-22.preview" \
  -d "payment_method=pm_..." \
  -d "seller_details[network_business_profile]=profile_test_61TU90nIeGjU7NNVXA6TU90m7ISQWsBxpcx9lASWWXTk" \
  -d "usage_limits[currency]=usd" \
  -d "usage_limits[expires_at]=1798761600" \
  -d "usage_limits[max_amount]=1000" \
  --data-urlencode "return_url=https://example.com/agent-checkout/return"
```

- `profile_test_61TU90nIeGjU7NNVXA6TU90m7ISQWsBxpcx9lASWWXTk` is Stripe's documented **test seller profile**.
- Revoke with `POST /v1/shared_payment/issued_tokens/spt_…/revoke`.
- Status goes `active` ⇄ `requires_action` (3DS: handle with `stripe.handleNextAction({hashedValue})`) → `deactivated`.
- Webhooks: `shared_payment.issued_token.{requires_action,active,used,deactivated}`.
- Supported methods: cards, Onelink, Apple Pay, Google Pay, Klarna, Affirm (limited).
- **UNVERIFIED:** whether a plain sandbox account can call `issued_tokens` without being enabled for the agent preview. Budget 10 minutes to try. If it fails, use the test helper below or `link-cli`.

**Seller side: receive and charge** ([seller tab](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens.md?agent-seller=seller))

```bash
# Test mode: simulate an agent granting you an SPT
curl https://api.stripe.com/v1/test_helpers/shared_payment/granted_tokens \
  -u "$STRIPE_SECRET_KEY:" -H "Stripe-Version: 2026-04-22.preview" \
  -d payment_method=pm_card_visa \
  -d "usage_limits[currency]=usd" -d "usage_limits[max_amount]=1000" \
  -d "usage_limits[expires_at]=1798761600"

# Charge it
curl https://api.stripe.com/v1/payment_intents -u "$STRIPE_SECRET_KEY:" \
  -d amount=1000 -d currency=usd \
  -d "payment_method_data[shared_payment_granted_token]=spt_123" -d confirm=true

# Inspect it (brand/last4/limits)
curl https://api.stripe.com/v1/shared_payment/granted_tokens/spt_123 \
  -u "$STRIPE_SECRET_KEY:" -H "Stripe-Version: 2026-04-22.preview"
```

- Before starting, create a **Stripe profile** in the Dashboard ([dashboard.stripe.com/profiles](https://dashboard.stripe.com/profiles)). Its `profile_*` ID is what agents target. You can also fetch it with `GET https://api.stripe.com/v2/network/business_profiles/me` using `Stripe-Version: 2026-07-29.preview`.
- Seller webhook: `shared_payment.granted_token.deactivated`.
- Live-mode self-test: `npx @stripe/link-cli spend-request create --credential-type shared_payment_token --network-id profile_… --amount 100 --context "…" --request-approval`.

**Connect variant** ([connect tab](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens.md?agent-seller=connect))

- Which profile the agent should target depends on the charge type:
  - **Destination charge, or separate charges and transfers:** give the agent the **platform** profile. This is the simplest option for us.
  - **Direct charge:** give the agent the **connected account's** profile. Creating profiles for connected accounts requires Stripe support to enable "connected account profile management", which is not hackathon-friendly.
- Charge with the usual Connect PaymentIntent (`transfer_data[destination]=acct_…`, or the `Stripe-Account` header for direct charges) plus `payment_method_data[shared_payment_granted_token]`.
- Scope: SPTs do not cover catalog, cart, tax, shipping or orders. The platform provides those, which fits what ShoperZero builds.

### 3. MPP: agent pays our API or checkout ([docs](https://docs.stripe.com/payments/machine/mpp.md), [sample repo](https://github.com/stripe-samples/machine-payments))

```ts
// npm i mppx stripe   (Next.js route handler works: it takes a Request and returns a Response)
import crypto from 'crypto';
import StripeClient from 'stripe';
import { Mppx, stripe } from 'mppx/server';

const mppSecretKey = crypto.createHmac('sha256', process.env.STRIPE_SECRET_KEY!)
  .update('mpp-challenge-signing').digest('base64');
const stripeMachinePayments = stripe.create({
  client: new StripeClient(process.env.STRIPE_SECRET_KEY!),
  networkId: process.env.STRIPE_PROFILE_ID!,            // profile_test_… in sandbox
  livemode: !process.env.STRIPE_SECRET_KEY!.includes('_test_'),
  depositAddresses: { tempo: process.env.TEMPO_DEPOSIT_ADDRESS! }, // optional stablecoins
});
const mppx = Mppx.create({ methods: stripeMachinePayments.defaultMethods(), secretKey: mppSecretKey });

export async function POST(request: Request) {
  const response = await mppx.charge({ amount: '12.50' })(request); // dynamic: order total
  if (response.status === 402) return response.challenge;
  return response.withReceipt(Response.json({ orderId: '…', status: 'paid' }));
}
```

- Minimums: **$0.50 for SPT or cards** and 0.01 USDC for stablecoins.
- Tempo deposit address: `POST /v1/crypto/deposit_addresses -d network=tempo` with `Stripe-Version: 2026-07-29.preview`. In a sandbox, `mppx` automatically configures Tempo **testnet**.
- Test:
  - `npx mppx@latest validate http://localhost:3000/api/checkout` runs a full roundtrip in the sandbox.
  - `npx @stripe/link-cli mpp pay <url> -X POST -d '{}' --context "…"` pays with an SPT.
  - `tempo request …` pays with crypto.
- This is the most demo-friendly "agent pays ShoperZero" rail: one endpoint gives cards via SPT plus stablecoins.

### 4. x402 on Stripe ([docs](https://docs.stripe.com/payments/machine/x402/quickstart))

- Setup:
  - Enable **Stablecoins and Crypto** in Payment methods. It stays "Pending" until Stripe reviews it.
  - Create a CDP account for the facilitator.
  - `POST /v1/crypto/deposit_addresses -d network=base` with `Stripe-Version: 2026-05-27.preview`.
- Install: `npm i @x402/core @x402/evm @x402/hono @coinbase/x402 hono @hono/node-server stripe`. Configure `paymentMiddleware` with `payTo: DEPOSIT_ADDRESS` on network `eip155:8453`.
- In `onAfterSettle`, record the payment:

```ts
await stripe.paymentIntents.create({
  amount: cents, currency: 'usd', confirm: true,
  payment_method_data: { type: 'crypto' }, allowed_payment_method_types: ['crypto'],
  payment_method_options: { crypto: { mode: 'transaction_verification',
    transaction_verification_options: { network: 'base', transaction_hash: txHash } } },
}, { idempotencyKey: txHash });
```

- Supported: USDC on Tempo, Base and Solana. Test with `purl` ([github.com/stripe/purl](https://github.com/stripe/purl)).
- The docs example moves **real funds**. Sandbox/testnet support for the Stripe deposit-address path is **UNVERIFIED**.
- For the hackathon: if we want x402, run the pure x402 facilitator on Base Sepolia (see the x402 research doc) and treat "Stripe records it" as a stretch goal.

### 5. Issuing for agents: we pay the store ([docs](https://docs.stripe.com/issuing/agents), [testing](https://docs.stripe.com/issuing/testing.md?testing-method=with-code))

Flow per order:

```bash
# once
curl https://api.stripe.com/v1/issuing/cardholders -u "$SK:" \
  -d "name=ShoperZero Agent" -d type=company -d status=active \
  -d "billing[address][line1]=123 Main Street" -d "billing[address][city]=San Francisco" \
  -d "billing[address][state]=CA" -d "billing[address][postal_code]=94111" -d "billing[address][country]=US"
# (docs example uses type=individual with individual[...] fields; company is fine for our own business)

# fund sandbox Issuing balance (US = pull funding via test top-ups; Dashboard or Top-ups API)

# per order: single-purpose card locked to the order total
curl https://api.stripe.com/v1/issuing/cards -u "$SK:" \
  -d cardholder=ich_… -d currency=usd -d type=virtual -d status=active \
  -d "spending_controls[spending_limits][0][amount]=4599" \
  -d "spending_controls[spending_limits][0][interval]=per_authorization" \
  -d "spending_controls[spending_limits][1][amount]=4599" \
  -d "spending_controls[spending_limits][1][interval]=all_time" \
  -d "metadata[order_id]=ord_123" -d "metadata[expected_merchant]=example-store.com"

# get PAN/CVC for the browser-checkout bot (server-side only)
curl -G https://api.stripe.com/v1/issuing/cards/ic_… -u "$SK:" -d "expand[]=number" -d "expand[]=cvc"

# sandbox: simulate the store charging the card
curl https://api.stripe.com/v1/test_helpers/issuing/authorizations -u "$SK:" \
  -d card=ic_… -d amount=4599 -d authorization_method=online \
  -d "merchant_data[name]=Example Store" -d "merchant_data[category]=miscellaneous_general_merchandise" \
  -d "merchant_data[country]=US"
curl -X POST https://api.stripe.com/v1/test_helpers/issuing/authorizations/iauth_…/capture -u "$SK:"
```

- Guardrail webhook `issuing_authorization.request` has a 2 s timeout. Approve if the amount is at most the order total and `merchant_data.name` fuzzy-matches the expected store; otherwise decline. Also subscribe to `issuing_authorization.created`, `issuing_transaction.created` and `issuing_dispute.updated`.
- Single-use cards: see [lifecycle controls](https://docs.stripe.com/issuing/controls/lifecycle-controls.md). As a fallback, set `status=canceled` after capture.
- Cost: **$0.10 per virtual card** (US).
- **Hard limits:**
  - Test cards cannot buy outside our own Stripe account.
  - Live Issuing needs an application, and "Cards for your platform" (issuing to end users) needs sales contact. Neither will be approved within the hackathon.
- **UNVERIFIED:** whether a sandbox Issuing card number can be used on a Stripe test-mode checkout in the **same** account. If it can, we can run a real end-to-end demo against our own demo store (for example a WooCommerce or Next.js store using our test keys).

### 6. Onelink Agent Wallet: the user's own wallet pays the store ([docs](https://docs.stripe.com/agentic-commerce/link-agent-wallet/use-link-wallet-pay-online.md), [repo](https://github.com/stripe/link-cli))

- Packages: `npm i -g @stripe/link-cli`, or the SDK `@stripe/link-sdk`. There is also a Go SDK.
- Auth: user OAuth against `login.link.com` with scope `payment_methods.agentic`. The token goes in `LINK_ACCESS_TOKEN`. The API is `api.link.com`, not `api.stripe.com`, and **no Stripe account is needed**.
- Create a spend request:

```bash
link-cli spend-request create --test \
  --amount 4599 --merchant-name "Example Store" --merchant-url "https://example-store.com/p/123" \
  --context "Buying 'Blue Mug' from example-store.com for the user via ShoperZero; user asked the agent to order it after comparing 3 options." \
  --line-item "name:Blue Mug,unit_amount:3999,quantity:1" --total "type:total,display_text:Total,amount:4599"
link-cli spend-request retrieve lsrq_… --interval 2 --max-attempts 300          # wait for approval
link-cli spend-request retrieve lsrq_… --include card --output-file /tmp/card.json --format json
```

- Credential types:
  - `card` (default): a one-time virtual card for any card form.
  - `shared_payment_token`: needs `--network-id profile_…`, for MPP or SPT sellers.
  - `link_pay_token`: for **Stripe-hosted checkouts**. These pages expose a hidden `.AiAgentPaymentSteering` "I am an AI agent" checkbox and an `input[name="link_pay_token"]`, which can replace form-filling entirely.
- Other behaviour:
  - Approval expires after 10 minutes.
  - `user-info retrieve` shows spend limits.
  - You can raise the amount after approval with `update` plus `request-approval`.
  - `link-cli report` tells Stripe about captchas and other blockers.
- `--test` returns test credentials (for example card `4000009990001984`) and never charges.
- Availability: **agent payments for US and Canadian consumers only**. Sellers can be anywhere.

### 7. Stripe Checkout Sessions / Payment Links for agents

- A classic Checkout Session or Payment Link is still the quickest pay-in when a human is in the loop. The agent returns the URL and the human pays. Checkout Sessions are GA, test-mode ready, and supported by Stripe MCP (`Create a Checkout Session`, `Create a payment link`).
- Stripe-hosted checkout pages now contain the agent steering block (see Onelink Pay Token above). Other agents can pay our Checkout pages without typing card data.
- ACS sellers receive agent orders as `checkout.session.completed` events. Use `expand[]=line_items.data.price.product&expand[]=payment_intent.latest_charge` with `Stripe-Version: 2025-12-15.preview`. `PaymentIntent.agent_details` is private preview.

### 8. Stripe MCP and Agent Toolkit

- MCP:
  - Remote server: `https://mcp.stripe.com`. Add it with `claude mcp add --transport http stripe https://mcp.stripe.com/`, or run `npm i -g @stripe/cli && stripe agent setup`.
  - Tools: `stripe_api_search`, `stripe_api_details`, `stripe_api_read`, `stripe_api_write`, `search_stripe_documentation`, and others. It covers Checkout Sessions, Payment Links, PaymentIntents and Issuing read endpoints. Issuing card *creation* is not in the listed methods. ([MCP docs](https://docs.stripe.com/mcp))
  - **From Oct 31, 2026, MCP rejects full secret keys and non-Agent restricted keys.** Use OAuth or an **Agent key**.
- `@stripe/agent-toolkit` v0.9.0 (`createStripeAgentToolkit` from `@stripe/agent-toolkit/langchain`, with Vercel AI SDK adapters). Only useful if our own agent needs to call Stripe as tools. For the ShoperZero MCP server we will expose our own tools such as `search_products`, `create_order` and `pay_order`.

### 9. Merchant of record / pay-on-behalf

- Stripe does not offer a turnkey "pay any merchant on the user's behalf" API outside private previews (Order Intents, ACS agent side).
- **If ShoperZero charges the user and then buys from the store, we are effectively the merchant of record for the user-facing charge, and a reseller to the store.**
  - That is fine for a hackathon demo.
  - In production it raises money transmission, MoR, tax, refund and chargeback questions.
  - Issuing "Cards for your own business" explicitly covers "making purchases to fulfill a service", which is the path Stripe accepts.
- The cleaner production model is **Onelink Agent Wallet**: the user's own card is used and the user approves, so we never hold funds. For merchants who opt in, the alternative is **SPT/ACP**: the merchant charges the buyer directly.
- Agents doing discovery and checkout "might be considered marketplace facilitators" with tax obligations ([for-agents](https://docs.stripe.com/agentic-commerce/for-agents.md?agent-checkout-mode=full)).

---

## Concrete recommendations for our hackathon build

### Architecture (Stripe slice)

```
Agent (Claude/ChatGPT via our MCP) ──► ShoperZero API  /api/orders (quote) ─► /api/orders/:id/pay
   pay-in (pick one or more):                                   │
   (1) MPP 402 endpoint (mppx) — SPT or Tempo testnet USDC      │
   (2) SPT posted in body → PaymentIntent(shared_payment_granted_token)
   (3) Checkout Session URL for human-in-the-loop               │
                                                                ▼
   pay-out to store:  Issuing single-use virtual card (sandbox, auth simulated)
                      OR Onelink spend-request card (user's wallet, --test)  → browser-checkout worker (Playwright)
   Supabase: orders(id, store_url, items, total, status, stripe_pi, issuing_card, spend_request, receipts)
```

### Path (a): intermediary. Recommended. Time to demo about 4–6 h for 2 people

| Step | What | Time |
|---|---|---|
| 1 | Stripe sandbox. Create a Stripe profile (`profile_test_…`). Set env `STRIPE_SECRET_KEY`, `STRIPE_PROFILE_ID`, `STRIPE_WEBHOOK_SECRET` | 15 min |
| 2 | `/api/orders` quote: price comes from our index, plus shipping estimate and a fee | 30 min |
| 3a | Pay-in via Checkout Session (`mode=payment`, `line_items[].price_data`, `metadata[order_id]`). Webhook `checkout.session.completed` marks the order paid | 30–45 min |
| 3b | Pay-in via SPT: accept `{spt}` in the body, create a PaymentIntent with `payment_method_data[shared_payment_granted_token]`. Test with `test_helpers/shared_payment/granted_tokens` | 45–60 min |
| 3c | Pay-in via MPP: a `mppx` route whose amount equals the order total. Test with `npx mppx validate` and `link-cli mpp pay` | 1–1.5 h |
| 4 | Pay-out via Issuing: enable Issuing in the sandbox, test top-up, one cardholder, a per-order card with limits and metadata, and an `issuing_authorization.request` webhook that approves only for the matching merchant and amount | 1.5–2 h |
| 5 | "Purchase" at the store: in the demo, call `test_helpers/issuing/authorizations` plus capture with `merchant_data[name]` set to the store (clearly labelled "simulated network auth"). Stretch: a Playwright worker fills the Onelink `--test` card into a real Stripe-test-mode demo store | 30 min, or 3–4 h for the stretch |
| 6 | Order timeline UI: paid → card issued → auth approved → captured | 1 h |

Why this path:
- It works for **any** store, which is our core pitch.
- It shows real Stripe primitives in a sandbox today.
- The guardrail story (per-order single-use card plus a real-time auth webhook) is very demoable.

### Path (b): merchant onboards (Connect + SPT/ACP). Time to demo about 3–5 h, as a second act or a pitch slide

1. Stripe Connect on our platform account. Onboard the merchant with an Account Link (Express or Standard). In test mode, onboard a fake merchant: 45 min.
2. For every indexed store that is "claimed", we expose ACP-shaped endpoints generated from our index:
   - `POST /acp/{store}/checkout_sessions`
   - `POST …/{id}` (update)
   - `POST …/{id}/complete` (accepts `payment_data.token = spt_…`)
   - `POST …/{id}/cancel`

   Take the schemas from the ACP OpenAPI spec `2026-04-17` ([spec](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol/tree/main/spec/2026-04-17/openapi)). Time: 1.5–2 h.
3. The agent targets **our platform profile**. On complete, create a destination charge with `payment_method_data[shared_payment_granted_token]=spt_…`, `transfer_data[destination]=acct_merchant` and `application_fee_amount`. Time: 45 min.
4. Order webhook to the merchant (email or webhook), where the merchant fulfils manually. Time: 30 min.
5. Bonus: offer merchants "push to Stripe ACS". Convert our normalized index to Stripe's product-feed CSV and upload it via `POST /v2/commerce/product_catalog/imports` using the **merchant's own** key. This only works for merchants who have their own ACS-enabled Stripe account. ACS for platforms is waitlist-only.

### Use this / skip this

- **Use:**
  - Sandbox, Stripe profile, Checkout Sessions, SPT seller test helper, `mppx` (MPP)
  - Issuing sandbox plus test-helper authorizations, real-time auth webhook
  - `@stripe/link-cli --test`
  - Stripe MCP for dev and debugging
- **Maybe:** raw SPT issuance from our own account (check whether preview access is needed), and the ACS catalog CSV export.
- **Skip:**
  - Order Intents
  - ACS agent side (`delegated_checkout`)
  - ACS for platforms
  - Issuing-card → PaymentMethod → SPT (private preview)
  - Live Issuing
  - Stripe x402 in live mode
  - UCP

### Implementation notes

- Preview API versions (`2026-04-22.preview`, `2026-05-27.preview`, `2026-07-29.preview`, `2026-08-26.preview`) may not be typed in the GA `stripe` npm SDK.
  - Simplest: call these endpoints with `fetch` and set the `Stripe-Version` header per request.
  - Alternative: pass `apiVersion` per request in stripe-node.
  - Keep GA calls (Checkout, PaymentIntents, Issuing) on the normal SDK.
- Next.js 16: put webhooks in `src/app/api/stripe/webhook/route.ts`. Read the raw body with `await req.text()` and pass it to `stripe.webhooks.constructEvent`. Make sure `src/proxy.ts` does not intercept `/api/stripe/*`.
- Never return PAN/CVC to the LLM. Only the browser worker should read card data, and it should be deleted after use. Use `link-cli --output-file` for the same reason.

---

## Open questions / risks

1. **SPT issuance access (UNVERIFIED).** Can a vanilla sandbox call `POST /v1/shared_payment/issued_tokens`, or is agent-preview enablement required? The seller test helper is documented without a gate.
2. **Issuing sandbox access.** It usually works immediately in a sandbox, but some regions or accounts need Issuing turned on in the Dashboard. The team's Stripe account must be a **US** entity for US pull funding. EU and UK accounts use push funding.
3. **Cross-merchant test purchases are impossible with Issuing test cards.** The demo must simulate the authorization or use our own demo store (same-account behaviour is UNVERIFIED).
4. **Whether Onelink test card `4000009990001984` is accepted by third-party Stripe test-mode checkouts is UNVERIFIED.** It is not the classic `4242…`.
5. **Browser checkout automation against real stores.** Captchas, bot walls, 3DS and account-required checkouts are the real risk, not Stripe. Pick 1–2 cooperative demo stores.
6. **Regulatory.** Intermediary resale means MoR, tax and refunds. Card-network rules also apply to issuing to end users ("Cards for your platform" requires Stripe approval). Frame it as a demo.
7. **Stripe MCP key change on Oct 31, 2026.** Use Agent keys or OAuth.
8. **Churn in preview versions.** Preview version strings moved four times in five months. Pin them in env and check the docs if calls 400.

---

## Sources

- Agentic commerce overview: https://docs.stripe.com/agentic-commerce
- Shared payment tokens (agent / seller / Connect): https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens.md?agent-seller=agent · ?agent-seller=seller · ?agent-seller=connect
- Sell through agents (ACS seller, catalog import API, order webhooks): https://docs.stripe.com/agentic-commerce/for-sellers.md
- Embed commerce / Delegated Checkout (private preview): https://docs.stripe.com/agentic-commerce/for-agents.md?agent-checkout-mode=full
- ACS for SaaS platforms (waitlist): https://docs.stripe.com/connect/saas/tasks/enable-in-context-selling-on-ai-agents.md
- ACP at Stripe: https://docs.stripe.com/agentic-commerce/acp · spec https://agenticcommerce.dev · https://github.com/agentic-commerce-protocol/agentic-commerce-protocol
- MPP: https://docs.stripe.com/payments/machine/mpp.md · https://mpp.dev · samples https://github.com/stripe-samples/machine-payments
- x402 on Stripe: https://docs.stripe.com/payments/machine/x402/quickstart · purl https://github.com/stripe/purl
- Issuing for agents: https://docs.stripe.com/issuing/agents · programmatic (SPT from Issuing, private preview): https://docs.stripe.com/issuing/agents/programmatic-checkout.md
- Issuing testing: https://docs.stripe.com/issuing/testing.md?testing-method=with-code · virtual card details: https://docs.stripe.com/issuing/cards/virtual.md
- Onelink Agent Wallet: https://docs.stripe.com/agentic-commerce/link-agent-wallet.md · spend requests: https://docs.stripe.com/agentic-commerce/link-agent-wallet/use-link-wallet-pay-online.md · https://github.com/stripe/link-cli · https://onelink.com/gb/agents
- Stripe MCP: https://docs.stripe.com/mcp
- Agent toolkit: https://www.npmjs.com/package/@stripe/agent-toolkit
- Sessions 2026 announcements: https://stripe.com/blog/everything-we-announced-at-sessions-2026
- Giving agents the ability to pay (Apr 29, 2026): https://stripe.com/blog/giving-agents-the-ability-to-pay
- Order Intents (private preview; docs page now 404): https://www.youtube.com/watch?v=bVQwIZYk9UM
- ACS launch: https://stripe.com/blog/agentic-commerce-suite
