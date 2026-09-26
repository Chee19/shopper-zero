// WS4-local contract subset from spec 00 §6.6. Replace these imports with
// the shared contracts when WS1 lands; keep service signatures and output fields.
import { z } from "zod";
export type Money = { amount: number; currency: string };
export type IsoDateTime = string;
export type CheckoutConnectorId = "woo_store_api" | "handoff";
export type PaymentRailId = "stripe_spt";
export const UCP_VERSION = "2026-08-25" as const;
export const PAYMENT_HANDLER_IDS = { stripe_spt: "app.shoperzero.stripe_spt" } as const;
export const QUOTE_TTL_SECONDS = 600;
// ---------- status / state ----------
/** UCP checkout status: what agents see. */
export const CHECKOUT_STATUSES = [
  "incomplete", "requires_escalation", "ready_for_complete",
  "complete_in_progress", "completed", "canceled",
] as const;
export type CheckoutStatus = (typeof CHECKOUT_STATUSES)[number];

/** Internal state machine (07 §5.4 + "handoff"). Stored in checkouts.state. */
export const CHECKOUT_STATES = [
  "quoting", "awaiting_payment", "requires_action", "payment_authorized", "placing_order",
  "order_placed", "completed", "refunding", "failed", "expired", "canceled", "handoff",
] as const;
export type CheckoutState = (typeof CHECKOUT_STATES)[number];

export const STATE_TO_STATUS: Record<CheckoutState, CheckoutStatus> = {
  quoting: "incomplete",
  awaiting_payment: "ready_for_complete",
  requires_action: "requires_escalation",
  payment_authorized: "complete_in_progress",
  placing_order: "complete_in_progress",
  order_placed: "completed",
  completed: "completed",
  refunding: "complete_in_progress",
  failed: "canceled",
  expired: "canceled",
  canceled: "canceled",
  handoff: "requires_escalation",   // no headless connector: continue_url for a human
};

/** Allowed transitions. WS4's transition() must reject anything else with ApiErrorCode "invalid_state". */
export const ALLOWED_TRANSITIONS: Record<CheckoutState, readonly CheckoutState[]> = {
  quoting: ["awaiting_payment", "handoff", "failed", "canceled"],
  awaiting_payment: ["awaiting_payment", "quoting", "requires_action", "payment_authorized", "expired", "canceled"],
  requires_action: ["awaiting_payment", "failed", "canceled"],
  payment_authorized: ["placing_order", "refunding"],
  placing_order: ["order_placed", "refunding", "requires_action"],
  order_placed: ["completed", "failed"],   // failed: capture failure after placement (CCR-W4-R2-4)
  refunding: ["failed"],
  handoff: ["canceled"],
  completed: [],
  failed: [],
  expired: [],
  canceled: [],
};

// ---------- inputs (zod is the source of truth; validate every agent input) ----------
export const AddressSchema = z.object({
  name: z.string().trim().min(1).max(200),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().max(100).optional(),               // state/province code, e.g. "CA"
  postal_code: z.string().trim().min(1).max(20),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/), // ISO 3166-1 alpha-2
});
export type Address = z.infer<typeof AddressSchema>;

export const BuyerSchema = z.object({
  email: z.email(),
  name: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
});
export type Buyer = z.infer<typeof BuyerSchema>;

export const LineItemInputSchema = z.object({
  variant_id: z.uuid().describe("IndexedVariant.id from search_catalog / get_product"),
  quantity: z.number().int().min(1).max(20),
});
export type LineItemInput = z.infer<typeof LineItemInputSchema>;

export const CreateCheckoutInputSchema = z.object({
  line_items: z.array(LineItemInputSchema).min(1).max(20), // all variants must belong to ONE store
  buyer: BuyerSchema.optional(),
  fulfillment: z.object({ address: AddressSchema }).optional(),
});
export type CreateCheckoutInput = z.infer<typeof CreateCheckoutInputSchema>;

/** Partial update: each field present REPLACES that field; absent fields are kept. */
export const UpdateCheckoutInputSchema = CreateCheckoutInputSchema.partial().extend({
  selected_shipping_option_id: z.string().min(1).optional(),
});
export type UpdateCheckoutInput = z.infer<typeof UpdateCheckoutInputSchema>;

export const PaymentCredentialSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("spt"), token: z.string().min(1).max(255) }),            // "spt_..." (fallback: "pm_card_visa")
]);
export type PaymentCredential = z.infer<typeof PaymentCredentialSchema>;

export const PaymentInstrumentSchema = z.object({
  handler_id: z.literal(PAYMENT_HANDLER_IDS.stripe_spt),
  type: z.literal("card"),
  credential: PaymentCredentialSchema,
});
export type PaymentInstrument = z.infer<typeof PaymentInstrumentSchema>;

export const CompleteCheckoutInputSchema = z.object({
  payment: z.object({ instruments: z.array(PaymentInstrumentSchema).length(1) }),
  idempotency_key: z.string().min(1).max(255).optional(),
});
export type CompleteCheckoutInput = z.infer<typeof CompleteCheckoutInputSchema>;

// ---------- outputs ----------
export interface LineItem {
  id: string;                 // "li_1", "li_2" ... stable within a checkout
  variant_id: string;
  product_id: string;
  title: string;              // product title
  variant_title: string;      // "M" or "Default Title"
  quantity: number;
  unit_price: Money;
  total: Money;               // unit_price * quantity (before shipping/tax)
  image_url: string | null;
  url: string | null;         // merchant PDP
}

export interface ShippingOption {
  id: string;                 // connector-specific, e.g. Woo "0:flat_rate:1"
  title: string;
  amount: Money;
}

export const TOTAL_TYPES = ["subtotal", "shipping", "tax", "discount", "total"] as const;
export type TotalType = (typeof TOTAL_TYPES)[number];
export interface Total { type: TotalType; amount: number; display_text?: string } // minor units in CheckoutSession.currency

export type PaymentHandler = {
  id: typeof PAYMENT_HANDLER_IDS.stripe_spt;
  rail: "stripe_spt";
  config: { accepted: "card"[]; test_mode: boolean; profile?: string };
};

export const MESSAGE_CODES = [
  "out_of_stock", "price_changed", "quote_expired", "missing_buyer", "missing_address",
  "shipping_option_required", "merchant_checkout_required", "payment_declined",
  "payment_requires_action", "order_failed_refunded", "unsupported_currency",
  "timeline_url", // WS5 CCR-6: {type:"info", code:"timeline_url", content:"Watch live: {APP_URL}/checkouts/{id}"} on every session
] as const;
export type MessageCode = (typeof MESSAGE_CODES)[number];
export interface Message {
  type: "error" | "warning" | "info";
  code: MessageCode | (string & {});
  content: string;            // human readable, no PII
  path?: string;              // JSONPath into the checkout, e.g. "$.buyer.email"
  severity?: "recoverable" | "requires_buyer_input" | "requires_buyer_review" | "unrecoverable";
}

export interface CheckoutLink { type: "timeline" | "merchant_product" | "terms_of_service"; url: string }

export interface Order {
  simulated: true;
  id: string;
  checkout_id: string;
  store_id: string;
  status: "placed" | "confirmed" | "failed" | "refunded";
  merchant_order_id: string | null;
  merchant_order_url: string | null;
  payment: { rail: PaymentRailId; reference: string; amount: Money; payer?: string };
  created_at: IsoDateTime;
}

export interface CheckoutSession {
  simulated: true;
  id: string;
  ucp_version: typeof UCP_VERSION;
  store: { id: string; slug: string; domain: string; name: string | null };
  connector: CheckoutConnectorId;
  state: CheckoutState;
  status: CheckoutStatus;     // = STATE_TO_STATUS[state]
  line_items: LineItem[];
  buyer?: Buyer;
  fulfillment?: { address?: Address; options: ShippingOption[]; selected_option_id?: string };
  totals: Total[];
  currency: string;
  payment: { handlers: PaymentHandler[] }; // empty when state != awaiting_payment
  continue_url?: string;      // handoff / escalation URL (always set for connector "handoff")
  messages?: Message[];
  links: CheckoutLink[];      // always includes {type:"timeline", url:"{APP_URL}/checkouts/{id}"}
  order?: Order;
  expires_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface CheckoutEvent {
  id: number;
  checkout_id: string;
  from_state: CheckoutState | null;
  to_state: CheckoutState;
  message: string | null;     // human readable, NO PII (public timeline)
  data: CheckoutEventData;    // NO PII
  created_at: IsoDateTime;
}

/** WS5 CCR-5 / WS4 CCR-W4-8: WS4 writes exactly these keys, the timeline renders links from them. */
export type CheckoutEventData = {
  rail?: PaymentRailId;
  payment_intent_id?: string;
  merchant_order_id?: string;
  merchant_order_url?: string;
  continue_url?: string;
  amount?: Money;
  error_code?: string;
  simulated?: boolean;
};


export interface RequestContext {
  surface: "mcp" | "rest";
  request_id: string;
  idempotency_key?: string;
  agent_profile?: string;
}
export interface CheckoutService {
  createCheckout(input: CreateCheckoutInput, ctx: RequestContext): Promise<CheckoutSession>;
  updateCheckout(id: string, input: UpdateCheckoutInput, ctx: RequestContext): Promise<CheckoutSession>;
  getCheckout(id: string): Promise<CheckoutSession>;
  completeCheckout(id: string, input: CompleteCheckoutInput, ctx: RequestContext): Promise<CheckoutSession>;
  cancelCheckout(id: string, ctx: RequestContext): Promise<CheckoutSession>;
  getOrder(id: string): Promise<Order>;
  listCheckoutEvents(id: string): Promise<CheckoutEvent[]>;
}
