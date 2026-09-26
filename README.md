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

## Run the local demo

Requires **Node.js 22** and npm. Run these commands from the repository root:

```bash
nvm use                 # if you use nvm; otherwise use Node.js 22
npm install
npm run dev:mock
```

Open the [checkout demo](http://127.0.0.1:3000/demo/checkout). No Stripe, WooCommerce, or Supabase credentials are needed for this demo.

### Try a purchase

1. Select **Successful purchase** and create a checkout.
2. Review the $44 hoodie plus $5 shipping quote.
3. Confirm the simulated purchase, then inspect its payment reference, merchant order, and event timeline.
4. Retry completion to check that it returns the same order. Try a failure scenario to see the resulting state.

Stripe payments and WooCommerce orders are simulated. No money moves and no real merchant order is submitted. Checkout records are saved in `.mock-checkout/ledger.json`, so a saved checkout survives a server restart. This local file is not production storage. Use fictional buyer details.

### Run the scripted agent

With the demo still running, open another terminal:

```bash
npm run demo:agent
```

The script uses **MCP (Model Context Protocol)** to find the fixture hoodie, create and complete a simulated checkout, retry completion, and retrieve the order. It saves the tool transcript to `artifacts/mock-checkout/agent-rehearsal.json`.

This is a deterministic test of the agent tools. It does not demonstrate an LLM independently navigating an arbitrary retailer.

### Compare the before/after storefronts

The repository also includes **Lumière de Provence**, a fictional beauty retailer modelled on Salesforce Commerce Cloud patterns. Start its two storefronts separately:

```bash
npm run demo:stores
```

| Open | What it shows |
| --- | --- |
| [Before storefront](http://localhost:4001/en-us/) | Hidden product data, a wrong-size cart bug, and an agent-blocking checkout challenge |
| [After storefront](http://localhost:4002/en-us/) | Readable product data, correct variant selection, and an accessible test checkout |

These storefronts demonstrate purchase blockers and fixes independently of the hoodie checkout demo. They keep test orders in memory and never take a payment. They do not connect to L’Occitane or any other live retailer. See the [before/after storefront guide](demo-stores/provence/README.md) for the specific changes.

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

## Development

The main application uses **Next.js 16, React, TypeScript, and Tailwind CSS v4**, with **Supabase for Postgres and authentication**. The local checkout demo uses its own file-backed storage.

### Work on features that use Supabase

In addition to Node.js 22, install Docker and the [Supabase CLI](https://supabase.com/docs/guides/cli). From the repository root:

```bash
npm install
supabase start
cp .env.example .env.local
```

Fill in the Supabase values in `.env.local` using the output of `supabase status`, then start the application:

```bash
npm run dev
```

The app runs at [localhost:3000](http://localhost:3000), and Supabase Studio runs at [127.0.0.1:54323](http://127.0.0.1:54323). This starts the main application; use `npm run dev:mock` above for the complete checkout demonstration.

### Checks

```bash
npm test                  # foundation, database, and checkout tests
npm run test:unit         # agent and output-format tests
npm run typecheck
npm run lint
npm run build
npm run test:integration   # requires the build; starts its own test server
```

### Repository layout

```text
src/app/                  Pages, HTTP routes, and demo UI
src/lib/checkout/         Checkout service, mock connectors, and local storage
src/lib/crawl/            Crawl service placeholders and tool registration
src/lib/scan/             Scan service placeholders
src/lib/contracts/        Shared schemas and types
src/lib/agent/            Catalogue access and agent-facing helpers
src/lib/formats/          Product feeds, discovery files, and output formats
src/lib/db/               Database access
src/lib/supabase/         Supabase clients and session refresh
src/lib/mcp/              MCP tools and registration
src/lib/payments/         Payment adapter
src/proxy.ts              Request proxy
scripts/                  Agent rehearsal and database helpers
supabase/migrations/      Database migrations
demo-stores/provence/     Fictional before/after storefront
mock/                     Visual prototypes
tests/                    Checkout and integration tests
docs/                     Specifications and research
```

The [specifications](docs/specs/README.md) describe the intended implementation; the [research index](docs/research/README.md) links supporting background. Follow the current code and runnable demos when distinguishing implemented features from planned work.

### Database changes and deployment

Create migrations with `supabase migration new <name>`, then run `supabase db reset` to reapply them locally. Do not edit migrations already on `main`.

The [deployment workflow](.github/workflows/deploy.yml) runs on pushes to `main`: it applies Supabase migrations, then deploys the application to [Vercel production](https://shopper-zero.vercel.app). It requires the repository secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, and `VERCEL_TOKEN`. The file-backed local checkout demo is not suitable for that production deployment.
