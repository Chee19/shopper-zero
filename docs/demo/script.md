# Lumière: the two-minute demo

The story: select a product, show what goes wrong on the before-store, then complete a purchase through ShopperZero and match it to the merchant receipt. Lumière is a fictional store with prepared before/after versions. Payments are simulated. This script does not demonstrate an automatic scan or conversion.

Start the connected demo with `npm run demo:provence`. Run `npm run demo:rehearse -- --headed --runs=1` for the live browser sequence below. The runner uses an MCP client; it requires no chat application, model key or wallet service. It performs new local purchases, records the browser, and saves evidence in an ignored artifact directory.

| Time | Screen and action | Narration |
|---|---|---|
| **0:00** | Lumière before: open the hand cream product. | “Can an assistant buy the right product and prove what happened? This is Lumière de Provence, our prepared test store. The payment is simulated.” |
| **0:12** | Select **75 ml** at **$24**, add to bag, then show **150 ml** in the cart. | “I selected 75 millilitres. The page showed the right price, but the cart contains 150. Being able to read a product page isn't enough to complete the right purchase.” |
| **0:27** | The declared shopping agent reaches checkout and receives **Access denied**. | “The checkout also blocks our declared shopping agent. We stop at that boundary.” |
| **0:38** | Switch to Lumière after. Select 75 ml; show the matching cart and accessible checkout. | “This is the prepared after-store. The same selection now adds the correct item, and the agent can reach checkout.” |
| **0:52** | Show the after-store’s `llms.txt`; the runner checks its product feed and UCP profile. | “The store publishes product and variant data, plus instructions an agent can read. ShopperZero uses the merchant's own cart and order routes.” |
| **1:04** | MCP searches for hand cream, inspects `01HC075`, creates the checkout, then opens its individual timeline. | “Our MCP client finds the 75-millilitre item and gets a quote: 24 dollars, 6.95 shipping and 1.98 tax. The total is 32.93.” |
| **1:24** | Confirm via MCP. Watch the open page update to **Agent checkout complete** without reloading. | “We confirm the simulated payment. The sequence is authorize, place the merchant order, then capture. The timeline follows the same checkout.” |
| **1:40** | Open **Lumière order** and show its `LDP…` receipt. | “Here is the merchant's receipt: the same item, size, quantity and total. Its order ID and payment reference match our checkout record.” |
| **1:51** | Repeat the identical confirmation; return to the same completed checkout. | “Retrying returns the same order. One authorization, one capture, one merchant order. That's the complete purchase, with evidence on both sides.” |
| **2:00** | Leave the completed timeline visible. | Leave the remaining minute for questions. |

The runner prints each cue and waits for its scheduled time. Its recording is silent, for a presenter to narrate. Two automated timed runs verify the sequence and timing; the presenter should still practise the spoken lines.

Use the exact `/checkouts/{id}` URL returned by the purchase. `/checkouts/live` currently looks for database-backed events; the Lumière checkout ledger is local.

If a step fails, use the saved video or the matching receipt from a completed rehearsal and identify it as recorded. See [the runbook](runbook.md) and [Q&A](qa.md).
