# ShopperZero

Make commerce stores accessible to shopping agents: scan a store, publish an agent-readable catalog, and complete a purchase.

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
