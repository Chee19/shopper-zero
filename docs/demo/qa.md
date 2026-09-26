# Judge Q&A cheat sheet

Source: spec 05 §10.5.


- **"How is the score computed?"** We try three access methods in the order an agent would: API, then reading the page (DOM), then computer use. We score the best method that works plus its capabilities (catalog, price and stock, variants, cart, checkout reachable). API is the top band, DOM the middle, computer use the bottom. The per-task time and cost make the difference concrete: roughly 1 s / $0 against 90 s / $0.30.
- **"Is computer use safe? Does it buy things?"** No. It is capped at 15 steps, runs on public pages only, and **always stops before payment**. Screenshots are shown so you can audit every step.
- **"Why not Shopify's Agentic plan?"** It needs merchant sign-up, a catalog sync into Shopify, and per-sale fees and terms. We're zero-touch, open, emit standard protocols from merchant-owned endpoints, and cover Woo, Magento, BigCommerce, Squarespace and custom stores. The ~4% fee is unverified, so don't quote it.
- **"Readiness scanners already exist (Cloudflare Agent Readiness)."** Scores are commodity. We add the cost-per-task view across three real access methods, and more importantly we **fix** the store in one click and prove it with a completed checkout.
- **"Is crawling legal? robots.txt?"**
  - We honor robots.txt, crawl-delay and Content-Signal.
  - We use an identifiable user agent (`/bot` explains it), at 1–2 requests per second.
  - We read public, logged-out pages only and **never bypass bot protection**; those stores are marked blocked.
  - Images are hotlinked.

  Legal risk is ToS/contract rather than CFAA: hiQ v. LinkedIn (2022; hiQ lost on contract) and Meta v. Bright Data (2024). Consent is handled by the claim and opt-out loop, which is the lesson of Amazon "Buy for Me".
- **"Who's the merchant of record?"** In the demo, the agent pays ShoperZero and we place the order on **our own** Woo store with an offline method plus a receipt note. Third-party stores get a `continue_url` handoff. In production, "we buy from the merchant" would make us a reseller/MoR (tax, chargebacks), so production runs through the merchant plugin or Stripe Connect, with the merchant as MoR.
- **"Isn't this Rye / Channel3 / Crossmint?"** They're closed, per-call, agent-developer side, and often browser automation. We give the merchant open endpoints and a claim loop, and agents use them for free. Our computer-use probe is a diagnostic, not the product.
- **"Stale prices?"** `verifyOffer` checks live before the quote. Woo `expected_total` guards against drift, quotes have a 10-minute TTL, and the total is immutable once awaiting payment.
- **"UCP-compliant?"** We mirror Shopify's live profile (`2026-08-25`, also listing `2026-04-08`) and claim only the capabilities we implement. We have not been certified.
- **"How does claiming stop impostors?"** The token only counts when it is published in that domain's DNS or homepage HTML, like Google Search Console. Tokens sit in a private table.
- **"Business model?"** (Pitch suggestion; not researched.) The scan is free. Endpoints are free for agents. Merchants pay for verified or native checkout, and there is a take rate on agent checkouts.

