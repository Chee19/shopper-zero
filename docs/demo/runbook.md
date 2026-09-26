# Lumière demo runbook

The executable sequence is in [the two-minute script](script.md). It covers the prepared before/after storefronts, MCP discovery, a $32.93 quote, simulated payment, automatic timeline updates, merchant receipt and duplicate prevention.

## Launch

```sh
npm ci
npm run demo:provence
```

The launcher starts the before-store on 4001, after-store on 4002, and ShopperZero on 4174. For a production build, stop any existing launcher first, then run:

```sh
npm run build
npm run demo:provence -- --production
```

Restart after every build so the running server and browser assets match. Keep `NEXT_PUBLIC_UI_MOCK` unset for this connected purchase demonstration. The launcher enables the local checkout service and points it at Lumière after.

## Rehearse

```sh
# Two timed runs, about two minutes each, with recordings and evidence:
npm run demo:rehearse

# One visible stage run for the presenter to narrate:
npm run demo:rehearse -- --headed --runs=1

# Fast check of the same journey, without presentation pauses:
npm run demo:rehearse -- --quick --runs=1

# Purchase tools only:
npm run demo:agent
```

The browser runner uses Chromium or installed Chrome. It declares itself as `ShopperZero/1.0 judge-rehearsal`, which makes the before-store's intended checkout block reproducible. A normal human browser may pass that store's browser check. The runner accepts local HTTP origins only and checks that the checkout is explicitly simulated before confirmation.

Each complete run buys one 75 ml Shea Butter Hand Cream (`01HC075`). Keep enough stock for both rehearsals and the stage run. Existing order history is preserved. The runner stops at the first failed assertion and saves the stage, checkout ID if available, and screenshot; inspect any pending checkout before retrying.

Optional environment variables are `MOCK_CHECKOUT_APP_URL`, `PROVENCE_BEFORE_URL` and `PROVENCE_STORE_URL`. Use `--output=/absolute/path` to choose another evidence directory. `--runs` accepts 1–5.

## What to check before presenting

- The runner reports a clean full pass and prints the individual checkout URL.
- The before-store adds 150 ml after selecting 75 ml; its declared-agent checkout returns 403. These are deliberate fixture behaviors.
- The after-store adds `01HC075`; standard total is **$24 + $6.95 + $1.98 = $32.93**.
- The current checkout timeline updates without reloading, and the merchant receipt shows the same `LDP…` order and $32.93 total.
- Repeating completion leaves one merchant order, one authorization and one capture.
- The latest recording is available locally. The recording is silent; practise the narration in the script.

Useful pages:

| Page | Address |
|---|---|
| Lumière before | http://127.0.0.1:4001/en-us/ |
| Lumière after | http://127.0.0.1:4002/en-us/ |
| Checkout controls | http://127.0.0.1:4174/demo/checkout |
| Purchase MCP endpoint | http://127.0.0.1:4174/api/mcp |
| Checkout timeline | The `/checkouts/{id}` URL printed by the runner |
| Merchant receipt | The **Open Lumière order** link on that timeline |

Use the local purchase MCP endpoint for this script. The shared `/api/ucp/mcp` catalog, scan/indexing workflow, claims and `/checkouts/live` database follower are separate integrations and are not prerequisites for this purchase demonstration.

## Evidence and fallback

The default output is `artifacts/mock-checkout/judge-rehearsals/<timestamp>/`, ignored by Git. `results.json` records timing and checkout/order IDs. Each `run-N` directory contains `rehearsal.webm`, stage screenshots and `evidence.json` with the MCP transcript, merchant record and payment proof. Do not commit generated recordings, ledgers or the private judges document.

| Problem | Action |
|---|---|
| Server unavailable or old assets | Stop the launcher, rebuild if needed, relaunch, then run the quick rehearsal. |
| Before-store says Access denied | Expected for the declared agent. Continue to the prepared after-store. |
| Quote differs from $32.93 | Stop before confirming. Check the SKU, quantity, standard shipping and selected scenario. |
| Payment/order outcome is uncertain | Keep the checkout ID and retry that checkout; the service reconciles its merchant order. |
| Timeline appears empty | Open the printed `/checkouts/{id}` URL. The global live page reads a different event store. |
| Rehearsal fails on stage | Play the saved full-run video, identify it as recorded, and show its matching receipt. |

For failure handling in Q&A, the checkout controls also expose declined payment, changed price, failed order placement, failed capture and merchant handoff. Capture failure cancels the local merchant order and restores stock. These scenarios are outside the timed success run.
