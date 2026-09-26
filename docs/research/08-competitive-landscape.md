# 08: Competitive Landscape, Positioning and Demo Narrative

_Researched 2026-09-26. Web-verified where a URL is cited. Anything marked **UNVERIFIED** came from secondary sources or could not be confirmed._

---

## TL;DR

- **The protocol layer is done and the incumbents own it.** UCP (Google + Shopify, announced NRF, Jan 11 2026) covers discovery, cart and checkout. ACP (OpenAI + Stripe) is still maintained. AP2, Visa TAP and Mastercard Agent Pay handle payment trust. x402 and Stripe MPP handle machine payments. We should **emit** these protocols, not invent a new one. ([ucp.dev](http://ucp.dev/), [Google dev blog](https://developers.googleblog.com/under-the-hood-universal-commerce-protocol-ucp/), [Stripe ACP docs](https://docs.stripe.com/agentic-commerce/acp), [Stripe MPP](https://stripe.com/blog/machine-payments-protocol))
- **Shopify is the biggest threat.** Its **Agentic plan** lets *non-Shopify* merchants sync a catalog into Shopify Catalog and sell in ChatGPT, Gemini/AI Mode, Copilot and Perplexity. There is no monthly fee; Shopify charges per sale. The catch: the merchant has to sign up, push a feed and accept Shopify's fees and terms. ([shopify.com/agentic-plan](https://shopify.com/agentic-plan), [Weaverse](https://weaverse.io/blogs/shopify-agentic-plan-non-shopify-merchants-2026))
- **In-chat checkout stalled, but discovery is growing.** OpenAI moved Instant Checkout into merchant "Apps" (Mar 6 2026). Reports say only about 30 Shopify merchants were live by February. ACP was extended to product discovery (Mar 24 2026). Our takeaway: **discovery or index quality is the part that matters now**, and checkout is where the demo gets its wow. ([Digital Commerce 360](https://www.digitalcommerce360.com/2026/03/06/openai-shifts-checkout-plans-agentic-commerce-strategy/))
- **"Any store, no merchant integration" already exists, but it is closed and paid per call.** Rye does browser-automated checkout and now accepts x402 through AgentCash. Henry Labs and Crossmint also do this. Channel3 and Klarna APP sell catalogs of 100M+ products. None of them gives the **merchant** an open, self-serve, protocol-native endpoint (`/.well-known/ucp`, `products.json`, MCP) for their own store. ([rye.com](https://rye.com/), [Channel3](https://trychannel3.com/), [Klarna APP](https://thefintechtimes.com/klarna-launches-agentic-product-protocol-to-make-100m-products-readable-by-ai/))
- **The long tail is unserved.** As of Aug 2026, WooCommerce (about a third of stores) had no native UCP support. Merchants rely on third-party plugins such as `ucp-for-woocommerce` (passes 75/75 UCP conformance tests) and Agentabile. Magento, PrestaShop and custom stores have to "build it or wait". ([UCP blog on WooCommerce](https://universalcommerceprotocol.blog/en/woocommerce-ucp/), [GitHub ooasis](https://github.com/ooasis/ucp-for-woocommerce), [onPoint](https://onpoint.to/google-ucp-checkout-just-landed-in-the-main-serp-and-woocommerce-wasnt-invited/))
- **Our position: "Cloudflare for agentic commerce."** Paste any store URL and within 60 seconds it serves a normalized `products.json`, a UCP-shaped catalog and an MCP endpoint. The merchant can then **claim** the store (DNS TXT or meta tag) to get verified pricing, opt-in controls and native checkout. The claim flow is also the answer to Amazon "Buy for Me" style backlash over indexing without consent. ([Modern Retail on Buy for Me](https://www.modernretail.co/technology/brands-are-upset-that-buy-for-me-is-featuring-their-products-on-amazon-without-permission/))
- **Demo story:** a WooCommerce test store we control → scan → agent-readiness score goes from F to A → Claude, through our MCP server, searches across several stores → buys on our test store with x402 (Base Sepolia) or Stripe test mode → the order shows up in the store and on our dashboard.
- **Readiness scanners are commodity.** Cloudflare, AgentReady, Asva, AgenticTrack and others already give out free scores. A score alone does not stand out. **Fixing the store automatically (hosting the endpoints) plus a completed checkout** does.

---

## Details

### 1. Landscape map (Sept 2026)

Legend for **Target**: M = merchant-facing, A = agent-developer-facing, S = AI surface (a consumer app).

#### A. Platforms and AI surfaces (the "demand side" and the protocol owners)

| Player | What they do now | Target | Non-Shopify coverage | Access / pricing |
|---|---|---|---|---|
| **Shopify** (UCP, Catalog API, Global Catalog MCP, Agentic Storefronts, Agentic plan) | Co-authored UCP with Google. Catalog API is UCP's discovery layer. Spring '26 Edition (shipped Jun 18 2026) removed the approval gate: devs register an agent profile and call the public MCP. The **Agentic plan** syncs non-Shopify catalogs into Shopify Catalog and puts them in ChatGPT, Gemini, Copilot, Perplexity and the Shop app. | M + A | **Yes, but opt-in.** The merchant must sign up and sync. Checkout routes to the merchant's existing storefront through an in-app browser (Weaverse). The Global Catalog MCP appears to be Shopify-merchant scoped (UNVERIFIED whether Agentic-plan merchants appear there). | Agentic plan: no monthly fee, pay per sale (card rates plus an AI-channel fee; the reported ~4% is **UNVERIFIED**). Availability is "get updates", so rollout is partial. [shopify.dev/docs/agents](https://shopify.dev/docs/agents), [Global Catalog MCP](https://shopify.dev/docs/agents/catalog/global-catalog), [Spring '26](https://www.shopify.com/news/spring-26-edition-dev) |
| **Google** (UCP, AP2, AI Mode / Gemini checkout) | UCP-powered checkout in AI Mode and Gemini. Merchant Center feed plus a UCP API on the merchant backend. AP2 handles payment mandates. | M / S | **Yes in principle.** It is platform-agnostic, but the merchant has to implement the UCP API and fill in an interest form. "Select merchants" only, in the US, CA and AU. | Free. Waitlist. [Merchant Center help](https://support.google.com/merchants/answer/16837055?hl=en), [AP2 + UCP codelab](https://codelabs.developers.google.com/next26/adk-agent-commerce) |
| **OpenAI** (ACP, Instant Checkout → Apps) | Instant Checkout launched Sep 2025 with Etsy and Shopify merchants. In Mar 2026 it was deprioritized, and checkout moved into merchant ChatGPT Apps. ACP was extended to discovery (Mar 24 2026). Product feeds and ads (self-serve Ads Manager) are growing. | S | ACP is open, but checkout is limited to OpenAI-approved merchants. | Feed submission is free. Ads are CPC. [OpenAI](https://openai.com/index/buy-it-in-chatgpt/), [DC360](https://www.digitalcommerce360.com/2026/03/06/openai-shifts-checkout-plans-agentic-commerce-strategy/) |
| **Perplexity** (+ PayPal Instant Buy) | In-chat Instant Buy through PayPal. 5,000+ merchants via PayPal. | S | Yes, **if the merchant is a PayPal merchant** and enabled through PayPal agentic services. | Free for users. [PayPal PR](https://newsroom.paypal-corp.com/2025-11-PayPal-and-Perplexity-Launch-Instant-Buy) |
| **Amazon** (Buy for Me, Shop Direct) | Agent buys on third-party brand sites for Amazon app users. It uses Nova plus Anthropic Claude. Since Mar 11 2026 it accepts third-party feeds (Feedonomics, Salsify, CedCommerce), and a merchant-direct feed is "coming". | S | **Yes, without consent.** Brands complained that listings appeared without permission, and opt-out is by email. This is the cautionary tale for us. | Not a product we can use. [TechCrunch](https://techcrunch.com/2026/03/11/amazon-expands-a-program-that-lets-customers-shop-from-other-retailers-sites/), [Modern Retail](https://www.modernretail.co/technology/brands-are-upset-that-buy-for-me-is-featuring-their-products-on-amazon-without-permission/) |
| **Microsoft** (Copilot Checkout, Brand Agents, Copilot Merchant Program) | In-chat checkout announced at NRF on Jan 8 2026. Shopify merchants are auto-enrolled with an opt-out. Payments run on PayPal and Stripe. Also a Dynamics 365 Commerce MCP server. | S / M | Non-Shopify merchants **apply via PayPal.ai**. | Free to apply. [PayPal PR](https://newsroom.paypal-corp.com/2026-01-08-PayPal-Powers-Microsofts-Launch-of-Copilot-Checkout), [MS Ads blog](https://about.ads.microsoft.com/en/blog/post/january-2026/conversations-that-convert-copilot-checkout-and-brand-agents) |
| **Meta** | Agentic shopping built on advertiser catalogs. Early stage. Acquired Manus (Dec 2025, per Rye). | S | Early. | UNVERIFIED |

#### B. Payments and trust rails

| Player | What | Target | Notes for us |
|---|---|---|---|
| **Stripe** | Agentic Commerce Suite (Dec 2025): low-code "sell on agents", ACP, **Shared Payment Tokens** (SPT; they now carry Visa IC, Mastercard Agent Pay, Affirm and Klarna). **MPP** (Machine Payments Protocol, with Tempo, Mar 18 2026) supports stablecoin and fiat via SPT. x402 on Base (Feb 2026). | M + A | **Most practical fiat checkout for our demo** (test mode). The merchant has to be on Stripe for native SPT. [ACS](https://stripe.com/blog/agentic-commerce-suite), [SPT docs](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens), [MPP](https://stripe.com/blog/machine-payments-protocol) |
| **Visa** | Intelligent Commerce (tokenized agent credentials, spend guardrails). Trusted Agent Protocol (with Cloudflare, built on Web Bot Auth). OpenAI integration announced Jun 10 2026, pilot. | A + M | TAP / Web Bot Auth is how a *well-behaved crawler or agent* identifies itself. We should sign our crawler requests. [Visa TAP](https://developer.visa.com/capabilities/trusted-agent-protocol) |
| **Mastercard** | Agent Pay (Agentic Tokens on MDES). Joined AP2 and UCP. | A + M | Reachable through Stripe SPT. Skip a direct integration. [eco.com comparison](https://eco.com/support/en/articles/15192003-mastercard-agent-pay-vs-visa-trusted-agent-2026-compared) |
| **PayPal** | Agent Ready (live early 2026) plus Store Sync (makes the catalog discoverable in Perplexity, Copilot and ChatGPT, and drops orders into existing fulfillment). Acquiring Cymbio. | M | **Closest merchant-side analog** to our "discoverability" pitch, but only for PayPal merchants, and the merchant has to integrate. [PayPal docs](https://developer.paypal.com/agentic-commerce-services/about), [paypal.ai](https://www.paypal.ai/) |
| **Klarna** | Agentic Product Protocol: an open standard plus hosted API. 100M+ products and 400M price points across 12 markets. Ingests Google Merchant, Shopify, Amazon, Meta or CSV/JSON feeds. | M + A | A discovery competitor, but it needs a merchant feed. Its schema is worth borrowing field names from. [Fintech Times](https://thefintechtimes.com/klarna-launches-agentic-product-protocol-to-make-100m-products-readable-by-ai/) |
| **Coinbase x402** | HTTP 402 payments in stablecoins. V2 shipped Dec 2025. Cloudflare and Stripe support it. Real commerce volume is small (about $28k/day per CoinDesk, Mar 2026). | A | Great for the demo because it is visual and needs no merchant account, but **merchants do not accept it for physical goods**. Present it as "agent pays ShoperZero, ShoperZero settles with the store", not "store accepts USDC". [CoinDesk](https://www.coindesk.com/markets/2026/03/11/coinbase-backed-ai-payments-protocol-wants-to-fix-micropayment-but-demand-is-just-not-there-yet), [whitepaper](https://x402.org/wp-content/uploads/sites/10/2026/06/x402-whitepaper.pdf) |
| **Cloudflare** | Web Bot Auth, pay per crawl, Monetization Gateway waitlist (Jul 2026). **Agent Readiness score** in URL Scanner (Apr 17 2026) checks robots, sitemap, llms.txt, MCP Server Card, API Catalog and WebMCP, and inspects x402/UCP/ACP without scoring them. **Cloudflare Wallets + cloudflare.pay** (Aug 4 2026). | Infra | **Our naming analogy and also a potential competitor.** Their readiness checks are a good checklist for our "after" state. [Agent Readiness](https://blog.cloudflare.com/agent-readiness/), [Fortune](https://fortune.com/2026/08/04/cloudflare-ai-agents-wallets-id/) |
| **Skyfire** (KYAPay), **Nekuda** (agent wallet SDK), **Payman**, **Prava**, **Basis Theory** (vault; leads the Agentic Commerce Consortium), **Lithic / Stripe Issuing / Marqeta / Highnote** (virtual cards) | Agent identity, wallets and card issuance. | A | Skip for the hackathon. If we need a "card the agent can use" story, Stripe Issuing test mode or Lithic sandbox works. [Rye landscape](https://rye.com/blog/agentic-commerce-startups), [Skyfire x Rye](https://skyfire.xyz/skyfire-x-rye-universal-checkout-kya-and-whats-on-the-other-side-of-the-agent-identity-wall/) |

#### C. Checkout execution for any store (closest to our checkout side)

| Player | What | Target | Non-Shopify | Pricing |
|---|---|---|---|---|
| **Rye** | Universal Checkout API: product URL plus payment token in, order out. Uses browser automation, with successful flows cached as deterministic workflows. Also a Product Data API. Claims 90%+ reliability and ~10s checkout. **Accepts x402 via AgentCash.** An OpenClaw "buy anything" skill exists. | A | **Yes, any web store, no opt-in.** The merchant stays merchant of record. | Not public (UNVERIFIED). [rye.com](https://rye.com/), [x402 post](https://rye.com/blog/agentcash-x402-agentic-commerce) |
| **Henry Labs** | Universal cart and one-click checkout across thousands of sites. Built on the Nekuda wallet. | A | Yes | Not public. [henrylabs.ai](https://www.henrylabs.ai/) |
| **Crossmint** | Checkout API for 1B+ items (`amazon:<asin>`, `shopify:<url>:<variantId>`). Crossmint is **merchant of record**. Has a checkout MCP server. | A | Mostly Amazon + Shopify locators | Not public. [docs](https://docs.crossmint.com/solutions/ai-agents/agentic-commerce/inventory), [MCP](https://github.com/Crossmint/mcp-crossmint-checkout) |
| **Zinc** | Purchasing API for Amazon, Walmart, Target and Best Buy. | A | 4 big retailers | Per order. [zinc.com](https://www.zinc.com/blog/agentic-commerce) |
| **Firmly** | "Buy Now" platform plus **Firmly Connect** (Mar 24 2026): no-code merchant onboarding. It autonomously integrates with the existing site, the merchant verifies business credentials, chooses channels and publishes the catalog. Best Buy and Backcountry are customers. | M | Yes | Enterprise. [Firmly Connect PR](https://www.globenewswire.com/news-release/2026/03/24/3261349/0/en/Firmly-Launches-Firmly-Connect-the-First-Agentic-Commerce-Platform-that-Allows-Merchants-to-Directly-Connect-to-Any-Agent-or-Agentic-Marketing-Channel-Without-Deploying-Any-Code.html) |

> **Firmly Connect is the closest analog to our "claim your store" flow.** The difference is that it is enterprise and sales-led, while ours is self-serve for the long tail, open, and emits endpoints any agent can hit.

#### D. Discovery, catalog and feed layer

| Player | What | Target | Non-Shopify | Pricing |
|---|---|---|---|---|
| **Channel3** (YC) | Universal product graph. 100M+ products and 5k+ brands (Walmart, Best Buy, Wayfair...). Search API, SDKs and MCP. Affiliate monetization. Checkout listed as "soon". | A | Yes | Free tier. About $7 per 1k queries (**UNVERIFIED**, secondary source). [trychannel3.com](https://trychannel3.com/) |
| **Catalog**, **Swap Commerce** | Universal extraction or product catalog for agents. | A | Yes | UNVERIFIED |
| **Feedonomics** (BigCommerce / Commerce.com) | **Agentic Catalog Exports** (Apr 27 2026) to ChatGPT, Gemini, Copilot, PayPal, Stripe, Perplexity and Amazon. Dell syndicated 7k SKUs. | M (enterprise) | Yes | Enterprise. [GlobeNewswire](https://www.globenewswire.com/news-release/2026/04/27/3281578/0/en/feedonomics-unlocks-agentic-discovery-with-agentic-catalog-exports.html) |
| **Productsup**, **Salsify**, **Syndigo**, **Akeneo** (MCP server) | PIM and feed management pushing ACP feeds to ChatGPT and others. | M (enterprise) | Yes | Enterprise. [Productsup ChatGPT](https://www.productsup.com/featured-integrations/chatgpt/) |
| **commercetools** (Agent Gateway), **Adobe Commerce** (committed to UCP + ACP), **SAP**, **Commerce Layer** | Headless and enterprise platforms adding agent endpoints. | M | Their own customers only | Enterprise. Commerce Layer specifics are **UNVERIFIED**. |
| **WooCommerce plugins**: `ucp-for-woocommerce` (UCP+ACP, 75/75 conformance), UCP/ACP Agent for WooCommerce, Agentabile (ACP feed) | Merchant installs a plugin to become protocol-native. | M | Woo only | Free / OSS. [wp.org](https://wordpress.org/plugins/ucp-acp-agent-for-woocommerce/), [GitHub](https://github.com/ooasis/ucp-for-woocommerce) |

#### E. AI visibility (GEO) and readiness scanners

| Player | What | Notes |
|---|---|---|
| **Profound** | Enterprise AI visibility. $155M raised, $1B valuation (Feb 2026). | Brand marketing, not catalog infrastructure. |
| **Bluefish** | "Agentic marketing". $43M Series B (Apr 2026). Includes an AI Commerce pillar. | Same. [PR](https://www.prnewswire.com/news-releases/bluefish-raises-43-million-series-b-to-power-agentic-marketing-for-the-fortune-500-302741124.html) |
| **Wildcard**, Sitefire, ReFiBuy, FERMÀT | SKU-level visibility in ChatGPT and Gemini, GEO. | Merchant analytics. |
| **Readiness scanners**: Cloudflare Agent Readiness, AgentReady, AgentsReady.store, Asva (147 UCP/ACP checks), AgenticTrack, `DeepanshuPal/agent-ready` (OSS CLI, A to F grade) | Free "is your store agent-ready?" scores. | **A score alone is commodity.** Borrow the idea of an A to F grade, and show the grade *after* we host the fixes. [Cloudflare](https://blog.cloudflare.com/agent-readiness/), [agent-ready](https://github.com/DeepanshuPal/agent-ready) |
| **Trust / anti-bot**: Forter, Signifyd, Riskified + HUMAN (AgenticTrust), Kasada, DataDome, Akamai | Distinguish good agents from bad bots. | **Risk:** our crawler and checkout agent may get blocked. Use polite crawling, platform APIs first and a Web Bot Auth signature. |

#### F. Standards bodies
- **Agentic Commerce Consortium** (Basis Theory, with Rye, Channel3, Crossmint, Skyfire, Henry, Lithic and others; 20+ members) defines **merchant opt-in** standards for agent transactions. Our claim/opt-in flow should borrow its language. [Basis Theory](https://blog.basistheory.com/agentic-commerce-consortium)
- **Consensus stack (Jan 2026, per The Register via Ekamoira):** MCP for tools, A2A for agent-to-agent, **UCP + AP2 for commerce**. [nventory](https://nventory.io/blog/acp-ucp-agentic-commerce-protocols-guide)

### 2. The gap ShoperZero fills

Every existing path to "agent-ready" requires one of these:
1. **Merchant work**: install a plugin, push a feed to Feedonomics or Klarna, sign up for the Shopify Agentic plan, PayPal Store Sync or Google's interest form.
2. **A closed aggregator** that the merchant does not control and that agent devs pay per call for: Rye, Channel3, Crossmint, Henry.
3. **No consent at all**: Amazon Buy for Me, which caused a backlash.

**ShoperZero = zero-integration, merchant-respecting, protocol-native endpoints for the long tail.**

- **For agent devs:** `https://shoperzero.app/s/{domain}/products.json` (Shopify-compatible shape, so existing Shopify-aware agents work unchanged), a UCP-shaped catalog and an MCP server (`search_products`, `get_product`, `create_checkout`). It works for *any* WooCommerce, Magento, PrestaShop, BigCommerce, Wix, Squarespace or custom store. It is free and open, and that is the wedge against Channel3 and Rye.
- **For merchants:** "Your store is already agent-ready. Claim it." Verify with a DNS TXT record or `<meta name="shoperzero-verification">` (Google Search Console style). This unlocks opt-out and field overrides, live-price webhooks, a "verified" badge that agents can rank on, a `/.well-known/ucp` redirect or CNAME so the merchant's **own domain** serves the protocol, and native checkout (Stripe SPT or a Woo REST order).
- **Compared to Shopify's Agentic plan:** no replatforming, no 4%-style AI-channel fee (Shopify figure UNVERIFIED), no single-vendor lock-in, and it works before the merchant has done anything.
- **The "Cloudflare for agentic commerce" analogy:** Cloudflare sits in front of any origin and adds capabilities (TLS, caching, bot rules). We sit in front of any store and add agent capabilities (catalog, search, checkout, identity). Cloudflare is heading into this space itself (Agent Readiness, Wallets, Web Bot Auth). Present that as validation, and point out that Cloudflare does not normalize catalogs or run checkout.

Honest caveat: Rye plus Channel3 together cover much of the *agent-dev* side of this. Our defensible angle is **openness plus the merchant claim loop plus emitting standard protocols**, not raw coverage.

---

## Concrete recommendations for our hackathon build

### The 2-minute demo script
1. **(0:00 to 0:15) Hook.** "Shopify stores are agent-ready out of the box: `/products.json`. The other ~75% of the web isn't. WooCommerce powers a third of stores and still has no native UCP (Aug 2026)." Show `curl https://some-woo-store.com/products.json` returning a 404.
2. **(0:15 to 0:45) Scan.** Paste 3 URLs (our own **WooCommerce test store**, one real Magento or PrestaShop store, one custom store with JSON-LD). A live progress view shows platform detected → strategy (Woo Store API / sitemap + JSON-LD / HTML fallback) → product counter ticking up. The readiness grade flips **F → A**.
3. **(0:45 to 1:05) Index.** Open `shoperzero.app/s/{domain}/products.json` (Shopify-compatible) and the MCP endpoint. Show one normalized product with variants, price, availability and image.
4. **(1:05 to 1:40) Agent.** In Claude Desktop or Claude Code, connected to the ShoperZero MCP: "Find me a waterproof jacket under $120 across these stores and buy the best one in M." The agent searches, compares, calls `create_checkout`, then pays with an **x402 payment on Base Sepolia** (visual, no card form) *or* a **Stripe test-mode SPT / PaymentIntent**.
5. **(1:40 to 1:55) Proof.** Our Woo test store admin shows a new order (created through the Woo REST API). The ShoperZero dashboard shows "checkout succeeded".
6. **(1:55 to 2:00) Merchant loop.** "The merchant claims the store with one DNS TXT record: verified badge, opt-out controls, their own `/.well-known/ucp`." Close with the metrics wall.

**Do real checkout only on a store we own.** Placing live orders on third-party stores during judging is a legal and reliability risk. For third-party stores, show "checkout handoff": a deep link to a pre-filled cart URL, e.g. Woo `?add-to-cart={id}`.

### Metrics for judges (big numbers on the dashboard)
- **Stores indexed**, with a split by detected platform (Woo / Magento / PrestaShop / BigCommerce / custom).
- **Products normalized** and **field completeness %**: price, availability, variants, images, GTIN.
- **Time-to-agent-ready**: median seconds from URL paste to a live `products.json`. Target under 60s for the demo stores.
- **Agent-readiness grade, before vs after**, reusing Cloudflare-style checks (robots, sitemap, llms.txt, MCP card, UCP/ACP presence).
- **Agent queries served** over the MCP / API.
- **Successful agent checkouts**, count and success rate, plus **payment rail used** (x402 / Stripe).
- **Price freshness**: age of the last price verification.

### Build priorities (tied to positioning)
- **Emit, don't invent.** Serve (a) a Shopify-compatible `products.json`, (b) a UCP-shaped catalog / `/.well-known/ucp`-style descriptor, (c) an MCP server. Even partial UCP compliance is a strong judging line. Check `docs/research` for the UCP spec track.
- **Merchant claim** is cheap to build: a `store_claims` table, a random token, a DNS TXT lookup (`dns.resolveTxt`) or a meta-tag fetch. It is worth a lot for the story ("consent-first, unlike Amazon Buy for Me").
- **Respect signals**: honor robots.txt, use an identifiable user agent (plus Web Bot Auth later), rate-limit, and give an opt-out endpoint. Say this out loud in the pitch.
- **Payments**: one rail done well. **Stripe test mode** is the most credible for fiat. Add **x402 on Base Sepolia** only if a teammate already knows it, since it demos well but is not a real merchant rail. Skip Visa/Mastercard/Skyfire/Nekuda integrations and just mention SPT covers them.
- **Positioning line**: "ShoperZero turns any store into a UCP/ACP/MCP-speaking store in 60 seconds, with no plugin and no replatforming, and the merchant can claim it any time."

---

## Open questions / risks

- **Shopify's Agentic plan narrows our gap.** Exact onboarding for Woo/Magento (feed? app?), fees and region are not documented on the public page (UNVERIFIED). If a judge asks "why not Shopify's Agentic plan", the answer is no merchant signup, no fee, open endpoints and no vendor lock-in.
- **Legal and ToS:** indexing without consent (the Amazon Buy for Me backlash), image copyright, and placing orders on sites we don't own. Mitigate with a claim/opt-out flow, robots compliance and demo checkout only on our own store.
- **Anti-bot blocking** (Cloudflare, DataDome, Kasada) on real stores during a live demo. Pre-scan and cache demo stores and keep a recorded fallback.
- **Price and stock freshness** without merchant cooperation: stale prices lead to failed checkouts. Show a "last verified" timestamp and re-verify at checkout time.
- **x402 is a weak merchant story** for physical goods: small real volume, and merchants don't accept USDC. Present it as agent → ShoperZero (as intermediary or MoR) and be ready for the question of who is merchant of record.
- **Protocol churn:** UCP (version 2026-04-08) and ACP (2026-04-17) versions move quickly. Pin versions in code comments.
- **Moat question:** Rye plus Channel3 already cover agent-dev needs commercially. Our answers are open/free, merchant-owned endpoints and protocol emission. Expect this question from judges.
- UNVERIFIED items: Channel3 pricing, Rye pricing and latency claims, the Shopify AI-channel fee %, Commerce Layer agentic features, and whether Agentic-plan merchants appear in Shopify's Global Catalog MCP.

---

## Sources

- Shopify: https://shopify.dev/docs/agents · https://shopify.dev/docs/agents/catalog/global-catalog · https://www.shopify.com/news/spring-26-edition-dev · https://shopify.com/agentic-plan · https://weaverse.io/blogs/shopify-agentic-plan-non-shopify-merchants-2026
- UCP / Google: http://ucp.dev/ · https://developers.googleblog.com/under-the-hood-universal-commerce-protocol-ucp/ · https://support.google.com/merchants/answer/16837055?hl=en · https://codelabs.developers.google.com/next26/adk-agent-commerce
- OpenAI / ACP: https://openai.com/index/buy-it-in-chatgpt/ · https://www.digitalcommerce360.com/2026/03/06/openai-shifts-checkout-plans-agentic-commerce-strategy/ · https://docs.stripe.com/agentic-commerce/acp
- Stripe: https://stripe.com/blog/agentic-commerce-suite · https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens · https://stripe.com/blog/machine-payments-protocol
- PayPal / Perplexity / Microsoft: https://developer.paypal.com/agentic-commerce-services/about · https://newsroom.paypal-corp.com/2025-11-PayPal-and-Perplexity-Launch-Instant-Buy · https://newsroom.paypal-corp.com/2026-01-08-PayPal-Powers-Microsofts-Launch-of-Copilot-Checkout · https://about.ads.microsoft.com/en/blog/post/january-2026/conversations-that-convert-copilot-checkout-and-brand-agents
- Amazon: https://techcrunch.com/2026/03/11/amazon-expands-a-program-that-lets-customers-shop-from-other-retailers-sites/ · https://www.modernretail.co/technology/brands-are-upset-that-buy-for-me-is-featuring-their-products-on-amazon-without-permission/
- Visa / Mastercard / Cloudflare: https://developer.visa.com/capabilities/trusted-agent-protocol · https://eco.com/support/en/articles/15192003-mastercard-agent-pay-vs-visa-trusted-agent-2026-compared · https://blog.cloudflare.com/agent-readiness/ · https://blog.cloudflare.com/secure-agentic-commerce/ · https://fortune.com/2026/08/04/cloudflare-ai-agents-wallets-id/
- x402: https://x402.org/wp-content/uploads/sites/10/2026/06/x402-whitepaper.pdf · https://www.coindesk.com/markets/2026/03/11/coinbase-backed-ai-payments-protocol-wants-to-fix-micropayment-but-demand-is-just-not-there-yet
- Checkout startups: https://rye.com/ · https://rye.com/blog/agentic-commerce-startups · https://rye.com/blog/agentcash-x402-agentic-commerce · https://www.henrylabs.ai/ · https://docs.crossmint.com/solutions/ai-agents/agentic-commerce/inventory · https://github.com/Crossmint/mcp-crossmint-checkout · https://www.globenewswire.com/news-release/2026/03/24/3261349/0/en/Firmly-Launches-Firmly-Connect-the-First-Agentic-Commerce-Platform-that-Allows-Merchants-to-Directly-Connect-to-Any-Agent-or-Agentic-Marketing-Channel-Without-Deploying-Any-Code.html · https://skyfire.xyz/skyfire-x-rye-universal-checkout-kya-and-whats-on-the-other-side-of-the-agent-identity-wall/
- Catalog / feeds: https://trychannel3.com/ · https://thefintechtimes.com/klarna-launches-agentic-product-protocol-to-make-100m-products-readable-by-ai/ · https://www.globenewswire.com/news-release/2026/04/27/3281578/0/en/feedonomics-unlocks-agentic-discovery-with-agentic-catalog-exports.html · https://www.productsup.com/featured-integrations/chatgpt/
- WooCommerce: https://universalcommerceprotocol.blog/en/woocommerce-ucp/ · https://github.com/ooasis/ucp-for-woocommerce · https://wordpress.org/plugins/ucp-acp-agent-for-woocommerce/ · https://wordpress.org/plugins/agentabile/ · https://onpoint.to/google-ucp-checkout-just-landed-in-the-main-serp-and-woocommerce-wasnt-invited/
- GEO / readiness: https://www.prnewswire.com/news-releases/bluefish-raises-43-million-series-b-to-power-agentic-marketing-for-the-fortune-500-302741124.html · https://nicklafferty.com/blog/profound-vs-bluefish/ · https://github.com/DeepanshuPal/agent-ready · https://agentreadystore.com/en · https://asvaai.com/features/agentic-readiness
- Standards: https://blog.basistheory.com/agentic-commerce-consortium · https://nventory.io/blog/acp-ucp-agentic-commerce-protocols-guide
