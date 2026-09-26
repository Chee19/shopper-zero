# ShopZero

**Lighthouse for agentic commerce.**

ShopZero tests whether an AI agent can find the right product and complete a purchase without human help. It gives merchants **a score, ranked blockers, and specific fixes** so they know where an agent gets stuck and what to improve first.

The question is simple: **can an agent actually buy from your store?**

**Current status:** this repository is an MVP in progress. You can run a local before/after storefront and a working checkout demo with simulated payments. The full live-store scanner, scoring, and report experience are still being built; the scan and crawl services currently contain placeholders.

## What the product is designed to do

1. **Test a shopping journey.** Find a product, read its price and stock, select the correct variant, add it to the cart, and attempt checkout.
2. **Show where it breaks.** Record the failing step and evidence: a bot challenge, missing product data, the wrong size in the cart, or a step that requires a person.
3. **Rank the fixes.** Give the merchant a readiness score and a prioritised list of blockers, with concrete recommendations.
4. **Retest after changes.** Run the same journey again to show whether the fixes helped.

The planned report includes a **0–100 score**, an **A–F grade**, evidence from each access method, and recommendations. Tests progress through store APIs, page structure, and browser interaction. Reaching checkout and completing an order are separate outcomes: the planned live-store browser probes stop before payment; a completed purchase needs a controlled checkout test.

The catalogue and checkout components support this workflow. An agent-readable product feed can fix discovery problems; a checkout integration can help complete a purchase. A human handoff still means the journey needs human help.

## Run the demonstration

Requires Node 22 or newer.

```sh
npm ci
npm run demo:provence
```

- Checkout: http://127.0.0.1:4174/demo/checkout
- Lumière before: http://127.0.0.1:4001/en-us/
- Lumière after: http://127.0.0.1:4002/en-us/

Choose a product, size and shipping method, then confirm the purchase. Orders appear in the Lumière storefront with matching receipt IDs. Payments are simulated; no vendor credentials or Supabase setup are needed for this flow. `npm run dev:mock` starts the same demonstration.

```sh
npm run demo:agent      # MCP catalog → 75 ml hand cream → checkout → receipt
npm test               # unit tests
npm run build
npm run test:integration
npm run test:browser   # uses the running checkout on port 4174
npm run lint
npm run typecheck
```

See the [checkout guide](docs/guides/checkout.md), [repository map](docs/guides/repository-structure.md), and [current specs](docs/specs/README.md).

## Layout

| Directory | Purpose |
| --- | --- |
| `src/app` | Next.js pages and API entry points |
| `src/features` | Checkout, crawling and scanning logic; feature UI and adapters |
| `src/contracts` | Shared schemas and interfaces |
| `src/infrastructure` | Database, Supabase and MCP integration |
| `src/shared` | Environment, errors, HTTP, logging, money and URL utilities |
| `demos` | Lumière storefronts and preserved design prototypes |
| `tests` | Unit, integration and browser suites |
| `scripts` | Demo and database commands |
| `docs` | Guides, specs and background research |
| `supabase` | Configuration, add-only migrations and seed |

The main application is one Next.js project. Prototype dependencies and builds are separate and ignored.

## Design prototypes

```sh
npm run demo:original                          # original static design, port 4173
npm ci --prefix demos/prototypes/grok
npm run demo:grok                              # extracted Vite prototype, port 4175
npm --prefix demos/prototypes/grok run build
```

## Database development

Install Docker and the Supabase CLI, then:

```sh
npm run db:start
cp .env.example .env.local
# Set the Supabase values printed by db:start.
npm run dev
```

Supabase Studio runs at http://127.0.0.1:54323. Create new migrations with `supabase migration new <name>`; existing migrations on main remain immutable. `db:types` and `db:types:remote` write generated types into `src/infrastructure/database`.

Every push to main applies Supabase migrations and deploys to Vercel through `.github/workflows/deploy.yml`. It requires `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, and `VERCEL_TOKEN`. The local demonstration uses file-backed state and runs on your computer.

## From prospect to demonstrated blocker

**SFCC usage identifies a prospect. A demonstrated failed purchase journey establishes the sales opportunity.**

Salesforce Commerce Cloud (SFCC), also known as Demandware, is a useful starting segment for prospecting. The research below comes from the supplied discussion and has **not been independently verified for this README**.

### L’Occitane: a demonstration prospect

The discussion reports an SFCC storefront using Cloudflare and Adyen, with DataDome bot protection. In the reported browser session, a **DataDome challenge appeared before the cart rendered**, preventing that agent session from continuing towards a purchase.

That is a concrete example of the problem ShopZero aims to diagnose. It is evidence about the reported session, not a current assessment of every L’Occitane storefront or shopping agent. Some payment details came from an **April 2025 archive** and need fresh verification.

### Find similar merchants through certificate logs

The proposed approach is to search **Certificate Transparency (CT) logs** for Salesforce hosting domains. Those certificate hostnames can contain merchant names or storefront domains; the discussion identifies them as more useful for this task than searching DataDome’s own domain.

| Reported source | What it can reveal | What still needs checking |
| --- | --- | --- |
| `cc-ecdn.net` | Hostnames that can encode public storefront domains | Extract the domain and verify that it is a live production store |
| `demandware.net` | Hostnames containing merchant or brand tokens | Map each token to the actual storefront, then verify it |

The pasted research reports roughly **2,000 production domains**, including about **82 UK domains**. Treat these as reported counts, not a verified current market size. Certificates can be historical, and a hostname alone does not establish current SFCC usage, bot protection, or a checkout failure.

The proposed prospecting workflow is:

1. Collect certificate hostnames from the reported hosting domains.
2. Filter for production storefronts, removing staging, development, and unrelated hosts.
3. Extract merchant domains, map brand tokens to storefronts, and deduplicate.
4. Prioritise UK and EU retailers.
5. Verify each live storefront and its current platform.
6. Test product discovery, cart, and checkout; record the exact blocker and supporting evidence.

Suggested prospects from the discussion: **Clarins, Space NK, Elemis, Lancôme, Kiehl’s, AllSaints, Kurt Geiger, and Currys**. These are candidates for verification, not confirmed blocked stores or customers.
