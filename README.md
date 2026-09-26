# ShoperZero

Make any non-Shopify e-commerce store agent-ready.

- **Discoverability** — crawl a store (sitemaps, JSON-LD, platform APIs, feeds) and expose a normalized, `products.json`-style index that agents can scan and search.
- **Checkout** — let agents complete purchases through a unified checkout layer (Stripe agentic payments, x402, or the store's native flow).

## Stack

- Next.js 16 (App Router, TypeScript, Tailwind v4)
- Supabase (Postgres, Auth) via `@supabase/ssr`

## Getting started

Requires Node 22 (`nvm use`), Docker (for local Supabase) and the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
npm install
supabase start                 # boots local Postgres/Auth, applies migrations
cp .env.example .env.local     # fill in values printed by `supabase status`
npm run dev                    # http://localhost:3000
```

Supabase Studio runs at http://127.0.0.1:54323.

## Layout

```
src/
  app/                 routes (pages + route handlers)
  lib/supabase/
    client.ts          browser client
    server.ts          server components / route handlers
    admin.ts           service-role client for crawlers & jobs (server-only)
    proxy.ts           session refresh used by src/proxy.ts
  proxy.ts             Next 16 proxy (formerly middleware)
supabase/
  config.toml
  migrations/          SQL migrations — add new ones with `supabase migration new <name>`
```

## Deployment

Every push to `main` runs `.github/workflows/deploy.yml`: Supabase migrations are applied first, then the app is deployed to Vercel production (https://shopper-zero.vercel.app).

Required repo secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `VERCEL_TOKEN`.

## Database changes

Create a migration with `supabase migration new <name>`, then `supabase db reset` to reapply locally. Don't edit migrations that are already on `main`.
