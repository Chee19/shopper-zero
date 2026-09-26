// Checkout timeline replays: spt, handoff (Stripe test payments only: DECISIONS MVP scope) (spec 05 §9.2). Event data uses the CCR-5 keys only.
import type {
  CheckoutEvent, CheckoutEventData, CheckoutSession, CheckoutState, LineItem, Total,
} from "@/components/lib/contracts";
import { STATE_TO_STATUS } from "@/components/lib/contracts";
import type { CheckoutReplay } from "@/components/realtime/types";
import { MOCK_APP_URL, MOCK_WOO_URL, RECORDED_AT, STORE_IDS } from "./stores";

const base = Date.parse(RECORDED_AT) + 10 * 60_000;
const iso = (ms: number) => new Date(base + ms).toISOString();

const HOODIE: LineItem = {
  id: "li_1", variant_id: "7c0ffee0-0001-4000-8000-000000000002", product_id: "7c0ffee0-0001-4000-8000-000000000000",
  title: "Hoodie", variant_title: "M", quantity: 1,
  unit_price: { amount: 4200, currency: "USD" }, total: { amount: 4200, currency: "USD" },
  image_url: null, url: `${MOCK_WOO_URL}/product/hoodie`,
};
const TOTALS: Total[] = [
  { type: "subtotal", amount: 4200 },
  { type: "shipping", amount: 500, display_text: "Flat rate" },
  { type: "total", amount: 4700 },
];

function session(id: string, over: Partial<CheckoutSession>): CheckoutSession {
  return {
    id,
    ucp_version: "2026-08-25",
    store: { id: STORE_IDS.woo, slug: "shoperzero-demo", domain: "demo-woo.example.com", name: "ShoperZero Demo" },
    connector: "woo_store_api",
    state: "quoting",
    status: "incomplete",
    line_items: [HOODIE],
    buyer: { email: "ada@example.com", name: "Ada Lovelace" },
    fulfillment: {
      address: { name: "Ada Lovelace", line1: "1 Demo St", city: "San Francisco", region: "CA", postal_code: "94105", country: "US" },
      options: [{ id: "0:flat_rate:1", title: "Flat rate", amount: { amount: 500, currency: "USD" } }],
      selected_option_id: "0:flat_rate:1",
    },
    totals: TOTALS,
    currency: "USD",
    payment: { handlers: [] },
    messages: [{ type: "info", code: "timeline_url", content: `Watch live: ${MOCK_APP_URL}/checkouts/${id}` }],
    links: [{ type: "timeline", url: `${MOCK_APP_URL}/checkouts/${id}` }],
    expires_at: iso(600_000),
    created_at: iso(0),
    updated_at: iso(0),
    ...over,
  };
}

type Step = [ms: number, from: CheckoutState | null, to: CheckoutState, message: string, data?: CheckoutEventData];

function build(id: string, recordedId: string, steps: Step[], final: Partial<CheckoutSession>): CheckoutReplay {
  let evId = 1000;
  const frames = steps.map(([ms, from, to, message, data]) => {
    const event: CheckoutEvent = {
      id: ++evId, checkout_id: id, from_state: from, to_state: to, message, data: data ?? {}, created_at: iso(ms),
    };
    return { at_ms: ms, event, checkout: { state: to, status: STATE_TO_STATUS[to], updated_at: iso(ms) } };
  });
  const last = steps[steps.length - 1]!;
  const checkout = session(id, { state: last[2], status: STATE_TO_STATUS[last[2]], updated_at: iso(last[0]), ...final });
  return { id: recordedId, recorded_at: iso(0), checkout, frames };
}

const SPT_ID = "3f9a1c2e-7b44-4c1a-9d0e-5a6b7c8d9e01";
const HANDOFF_ID = "c47b9a10-6e33-4d2f-b8a9-0f1e2d3c4b03";
const PI = "pi_3QzDemoSptA1b2C3d4E5f6";

export const CHECKOUT_SPT = build(SPT_ID, "spt", [
  [0, null, "quoting", "Cart created on WooCommerce Store API"],
  [1200, "quoting", "awaiting_payment", "Quote $47.00 frozen for 10 minutes", { amount: { amount: 4700, currency: "USD" } }],
  [9800, "awaiting_payment", "payment_authorized", "Stripe SPT authorized (manual capture)",
    { rail: "stripe_spt", payment_intent_id: PI, amount: { amount: 4700, currency: "USD" } }],
  [11000, "payment_authorized", "placing_order", "Placing order on WooCommerce"],
  [12400, "placing_order", "order_placed", "WooCommerce order #1042 placed",
    { merchant_order_id: "1042", merchant_order_url: `${MOCK_WOO_URL}/wp-admin/post.php?post=1042&action=edit` }],
  [12900, "order_placed", "completed", "Payment captured", { rail: "stripe_spt", payment_intent_id: PI, amount: { amount: 4700, currency: "USD" } }],
], {
  order: {
    id: "0dde0000-0000-4000-8000-000000000001", checkout_id: SPT_ID, store_id: STORE_IDS.woo, status: "confirmed",
    merchant_order_id: "1042", merchant_order_url: `${MOCK_WOO_URL}/wp-admin/post.php?post=1042&action=edit`,
    payment: { rail: "stripe_spt", reference: PI, amount: { amount: 4700, currency: "USD" } }, created_at: iso(12400),
  },
});

const CONTINUE = "https://www.berlinpackaging.com/cart.php?action=add&product_id=4411&qty=2";
export const CHECKOUT_HANDOFF = build(HANDOFF_ID, "handoff", [
  [0, null, "quoting", "Quote from indexed prices (no agent checkout API)"],
  [900, "quoting", "handoff", "Handed off to merchant checkout with a prefilled cart", { continue_url: CONTINUE }],
], {
  store: { id: STORE_IDS.berlin, slug: "berlinpackaging-com", domain: "berlinpackaging.com", name: "Berlin Packaging" },
  connector: "handoff",
  line_items: [{
    ...HOODIE, title: "16 oz Clear PET Plastic Bottle", variant_title: "Default Title", quantity: 2,
    unit_price: { amount: 89, currency: "USD" }, total: { amount: 178, currency: "USD" }, url: "https://www.berlinpackaging.com/16-oz-clear-pet",
  }],
  totals: [{ type: "subtotal", amount: 178 }, { type: "total", amount: 178 }],
  fulfillment: undefined,
  continue_url: CONTINUE,
  messages: [{ type: "warning", code: "merchant_checkout_required", content: "This store has no agent checkout API. Continue on the merchant site.", severity: "requires_buyer_review" }],
});

export const MOCK_CHECKOUTS: Record<string, CheckoutReplay> = {
  spt: CHECKOUT_SPT,
  handoff: CHECKOUT_HANDOFF,
};
