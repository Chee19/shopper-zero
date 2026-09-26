# Repository structure

The application uses one Next.js project. Routes stay in `src/app`; business logic and reusable UI live in `src/features`. Shared contracts are browser-safe. Database access, Supabase clients and MCP transports live under `src/infrastructure`; server-only modules retain their guards. Import browser clients and shared types directly, rather than through server barrels.

| Previous location | Current location |
| --- | --- |
| `src/lib/checkout` | `src/features/checkout` |
| Checkout `repo.ts` | `src/features/checkout/storage/file-repository.ts` |
| Checkout `fixtures.ts` | `src/features/checkout/demo/fixtures.ts` |
| Checkout UI in route folders | `src/features/checkout/components` |
| `src/lib/payments` | `src/features/checkout/payments` |
| `src/lib/crawl`, `src/lib/scan` | `src/features/crawl`, `src/features/scan` |
| `src/lib/agent`, `src/lib/formats` | `src/features/catalog`, `src/features/catalog/formats` |
| `src/lib/contracts` | `src/contracts` |
| `src/lib/db` | `src/infrastructure/database` |
| `src/lib/supabase` | `src/infrastructure/supabase` |
| `src/lib/mcp`, checkout MCP server/transport | `src/infrastructure/mcp` |
| Top-level `src/lib` utilities | `src/shared` |
| `demo-stores/provence` | `demos/provence` |
| `mock/index.html` | `demos/prototypes/original/index.html` |
| `mock/grok mock.zip` | `demos/prototypes/grok` (source only) |
| `scripts/agent-mock.ts` | `scripts/demo/agent.ts` |
| `scripts/db-smoke.ts` | `scripts/db/smoke.ts` |
| Unit tests scattered through source | `tests/unit` |
| `docs/mock-checkout.md` | `docs/guides/checkout.md` |

Feature-specific MCP tool registration stays with its feature. Framework routes call these services; they do not own business logic. Feature contracts extend the canonical schemas only where the local demonstration needs additional metadata.

The Grok prototype is an independent Vite reference with its own manifest and lockfile. Its dependencies and build output are ignored and excluded from the main app's TypeScript/ESLint checks.

Unit tests are discovered recursively by `npm test`. Integration and browser tests have separate commands. SQL migrations stay in `supabase/migrations` and are add-only. Local receipts and generated browser evidence are ignored; private hackathon research stays outside the repository.
