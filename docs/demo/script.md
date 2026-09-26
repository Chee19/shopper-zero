# The 2-minute demo script

Source: spec 05 §10.2. Rehearse twice; target 2:00 ± 10 s.


| Time | Screen / exact action | Say (verbatim-ish) |
|---|---|---|
| **0:00** Hook | Tab 1 `/`. The URL of the target is already typed. Click **Scan**. | "Can an AI assistant shop this store? Let's ask it the way an agent would." |
| **0:05** Cascade | `/scan/{id}`. The API card turns red signal by signal (products.json 404, no UCP, no MCP, no platform API) → **Failed**. The DOM card lights up: sitemap, JSON-LD, then the recipe fills in (price, add-to-cart selectors) → **Works**. The computer-use card says "Not needed". | "First we look for an API: UCP, MCP, a products feed. Nothing. Next we read the page itself, the way a scraper would, and learn where the price is and where to click. That works, barely." |
| **0:25** Score | The report renders: **grade D**, "reachable only by scraping", comparison "API ≈1 s / $0.00 vs computer use ≈90 s / $0.30". Point at the bars. | "That's a D. Every agent task here takes about 8 seconds of scraping, and it breaks when the theme changes." |
| **0:35** Worst case | Tab 2: the computer-use report, with its screenshot filmstrip. Scrub two thumbnails. | "And this is the worst case: no structure at all, so an agent clicks through screenshots. 90 seconds and 30 cents per task. We stop before payment." |
| **0:45** Fix | Back on tab 1, click **Make it agent-ready**. The indexing lane appears: counter ticking, stages Detect → Discover → Extract → Publish → Grade. The grade tile flips **D → A**, then the page auto-opens the store page. | "One click. We index the catalog the way we just found, normalize it, and host what Shopify stores get for free: products.json, a UCP profile, an MCP server, an ACP feed, llms.txt. No plugin." |
| **1:05** Output | The store page with the grade animating to A. Click **products.json ↗** for one second and close it. Point at the MCP row and "Connect to Claude". | "Same shape as Shopify's, so existing agents just work. From a D to an A." |
| **1:10** Claude buys | Claude Desktop: paste *"Using ShoperZero, find me a hoodie under $50 across the stores you can see and buy it in size M. Ship to Ada Lovelace, 1 Demo St, San Francisco, CA 94105, US, ada@example.com. Pay with the ShoperZero demo wallet."* Press Enter, then tab 3 `/checkouts/live`. | "Now the payoff. Claude searches every store we've made agent-ready, finds a hoodie on our WooCommerce store, and calls `create_checkout`: a live quote from the store's own API. It pays us with a Stripe Shared Payment Token, authorized with manual capture. We place the order, then capture." Narrate the rows as they stream. |
| **1:40** Proof | The timeline shows **completed**. Click **WooCommerce order #… ↗** (tab 4), then **PaymentIntent ↗** (tab 5). | "A real order in the merchant's admin, a real test PaymentIntent in Stripe." |
| **1:50** Close | Tab 1 `/`: the metrics strip. | "Stores where the only way in was scraping or screenshots are now one API call away. {N} stores scanned, {k} agent checkouts. ShoperZero: UCP for the other 80% of the web." |

**Timing guards:**
- If the scan hasn't reached the report by 0:30, keep narrating. At 0:40, switch to `/scan/replay-dom` (labeled Replay) and say "a recording of the same scan from 20 minutes ago".
- If indexing hasn't finished by 1:00, click "Open agent surfaces" anyway. The store page works with partial products.
- If Claude hasn't reached `create_checkout` by 1:25, open the rehearsal's `/checkouts/{id}`.
- The claim beat is optional. Use it in Q&A: "the merchant proves the domain with one DNS record" (tab 6, **Verify DNS**).

**Honesty line, only if asked why Claude bought from the Woo store:** "Native checkout needs a store API; we own this WooCommerce store for the demo. On the store we just fixed, Claude would get an honest prefilled-cart handoff, and we never place orders on stores that haven't opted in."

