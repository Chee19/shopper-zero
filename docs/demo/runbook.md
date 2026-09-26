# Demo runbook

Source: spec 05 §10.1, §10.3, §10.4. Replay routes that always work: `/scan/replay-{api,dom,cu,none}`, `/checkouts/live?replay={spt,handoff}` (always labeled "Replay").

> **Checkout timeline data path.** `checkout_events` is private (DECISIONS C9), so `/checkouts/{id}` polls the UI-only route `GET /api/v1/ui/checkouts/{id}` every 1.5 s (checkout with PII redacted + events). `/checkouts/live` follows the newest `checkout_events` row via `GET /api/v1/ui/checkouts/latest`. WS4's file-backed mock checkout doesn't write `checkout_events`, so while it's in use, open the `timeline_url` Claude prints ("Watch checkout: …/checkouts/{id}") instead. Claude connects to the composed agent MCP at `{APP}/api/ucp/mcp` (`/api/mcp` is WS4's mock-only server).

Backup video link (cloud drive): _fill in after the second clean rehearsal_

## Pre-demo checklist

**Infra (T-60)**
- [ ] Prod is deployed at a public HTTPS URL (Vercel). All env vars are set, including `ANTHROPIC_API_KEY`, `SCAN_CU_ENABLED=1`, `SCAN_CU_MAX_STEPS=15` and Browserbase keys (if used). `NEXT_PUBLIC_UI_MOCK` must be **unset**.
- [ ] **Tunnel up** for the Woo demo store (`cloudflared`, a named tunnel). `WOO_DEMO_URL` must equal the WordPress `siteurl`/`home`. Check: `curl -sI $WOO_DEMO_URL/wp-json/wc/store/v1/products | head -1` → `200`.
- [ ] Fallback app host: `npm run build && npm start` locally plus a second tunnel, with `APP_URL` set to it and the Claude connectors re-added.

**Pick the live scan target (T-60).** The story needs a **third-party store that lands in `dom` with a D/F grade** and can be indexed in under 30 s.
- [ ] Scan these candidates on prod and write down `best_method`, grade and duration:
  - `https://www.berlinpackaging.com` (BigCommerce: no public catalog API, JSON-LD LIVE-OK per research 04);
  - `https://www.camelbak.com`: likely `api` via SFCC, so a backup only;
  - any custom JSON-LD store found by WS2.
- [ ] Choose the first one that gives **`dom`, grade ≤ D, a scan under 20 s, and indexing of 40 products under 30 s**. Write it as the first entry of `demoPresets()` in `src/app/(site)/_lib/demo.ts`.
- [ ] Also keep one finished **computer-use** scan (a JS-only store, or `/scan/replay-cu`) open in a tab for the 10-second "worst case" beat.
- [ ] The live target must **not** be pre-indexed in the last 6 h. The CTA sends `force: true` anyway, but a fresh store makes the D→A jump honest.

**Data (T-45)**
- [ ] Pre-index the Woo demo store (`POST /api/v1/stores {url: WOO_DEMO_URL}`) and 4–6 other stores for the metrics: `hester-demo.squarespace.com`, `porterandyork.com`, `www.bulk.com/uk`, `www.camelbak.com`. Each must reach `indexed`. Drop any store that comes back `blocked`; never force it.
- [ ] `curl "$APP/api/v1/search?q=hoodie"` returns a Woo hoodie under $50 that is in stock. **UNVERIFIED** that the sample data has one; if not, create "Hoodie" at $42 in sizes S/M/L with stock management off.
- [ ] Claim staging (optional beat): open `/claim/{woo-slug}`, which creates the token, and publish it via DNS TXT on a domain we control, or via a mu-plugin in the Woo container: `wp-content/mu-plugins/sz-verify.php` → `<?php add_action('wp_head', fn() => print('<meta name="shoperzero-verify" content="TOKEN">'));`. Do not press Verify yet. Never press "Generate a new token" afterwards: it rotates the token.

**Payments (T-30)**
- [ ] The Stripe test mode SPT spike passes. If WS4 fell back, say "SPT-compatible PaymentIntent".

**Agent (T-20)**
- [ ] **Claude Desktop MCP configured:** "ShoperZero" → `{APP}/api/ucp/mcp` (the composed agent server; `/api/mcp` is WS4's mock-only one) and "ShoperZero Demo Wallet" → `{APP}/api/demo-wallet/mcp`. Disable other connectors and web search.
- [ ] A full rehearsal, choosing **"Always allow"** on every tool (**UNVERIFIED** that it persists; if not, narrate over the prompts).
- [ ] Optional: a Claude Project with the instruction "Use ShoperZero tools to shop; pay by calling wallet_issue_spt with the checkout total and passing the token to complete_checkout."
- [ ] Fallback agent: WS4's `scripts/agent-*.ts`.

**Stage (T-10)**
- [ ] Dark mode, Do Not Disturb, 125% zoom, hotspot as backup network.
- [ ] Tabs, in order:
  1. `/` with the target URL typed in the input, not yet submitted;
  2. the finished computer-use report (`/scan/{cu id}` or `/scan/replay-cu`);
  3. `/checkouts/live`;
  4. Woo admin → Orders;
  5. Stripe test Payments;
  6. `/claim/{woo-slug}` (optional);
  7. the backup video, paused at 0:00.
- [ ] Claude Desktop: a new chat, with the prompt on the clipboard.

## Failure decision tree

| Symptom | Action (≤ 5 s) |
|---|---|
| The live scan lands in `api`, or is blocked | Say "this one's already in decent shape". Open `/scan/replay-dom` (labeled Replay), or the second candidate's pre-run report. |
| The scan hangs (Realtime silent) | The polling fallback kicks in after 8 s. If it is still frozen, reload: the server render shows the latest state. |
| The CTA errors, or indexing fails | Open the pre-indexed store page of the second candidate, or `/stores/shoperzero-demo`. |
| The computer-use tab is broken | Use `/scan/replay-cu`: offline SVG screenshots, labeled Replay. |
| Claude stalls or picks wrong | Follow up with "Buy the Hoodie from ShoperZero Demo, size M." Otherwise use the WS4 agent script, then `/checkouts/live?replay=spt`. |
| Stripe fails | Use the explicitly labelled Stripe test fallback; if unavailable, show a clearly labelled recorded replay. |
| Woo tunnel down | Open the rehearsal `/checkouts/{id}` plus a screenshot of the Woo order. |
| Network gone | Play the backup video from the matching timestamp and narrate live. |

## Backup video plan

- Record **after the second clean rehearsal** with macOS Shift-Cmd-5 or OBS: 1920×1080, no voice, cursor visible.
- Two cuts:
  - (a) the full 2:00;
  - (b) 0:45 of cascade + D → A only.
- Keep both locally and in a cloud-drive link recorded in `runbook.md`. **Do not commit video files.**
- Save 7 screenshots for slides: cascade in progress, report D, computer-use filmstrip, D → A flip, products.json, timeline completed, Woo order.
- Re-record if the UI changes visibly.

