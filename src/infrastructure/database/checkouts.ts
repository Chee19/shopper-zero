import "server-only";
import type {
  CheckoutConnectorId, CheckoutEvent, CheckoutPaymentRecord, CheckoutRecord, CheckoutState, Order,
} from "@/contracts";
import { AppError, toAppError } from "@/shared/errors";
import { db } from "@/infrastructure/database/client";
import { iso, isoOrNull, toCheckoutEvent, toOrder } from "@/infrastructure/database/mappers";
import type { Tables, TablesUpdate } from "@/infrastructure/database/types.gen";
import { asJson, isMalformed, isUniqueViolation, isUuid } from "@/infrastructure/database/util";

export type NewCheckout = Omit<CheckoutRecord, "id" | "created_at" | "updated_at">;

function toCheckoutRecord(r: Tables<"checkouts">): CheckoutRecord {
  return {
    id: r.id,
    store_id: r.store_id,
    connector: r.connector as CheckoutConnectorId,
    state: r.state as CheckoutState,
    line_items: (Array.isArray(r.line_items) ? r.line_items : []) as unknown as CheckoutRecord["line_items"],
    buyer: (r.buyer ?? null) as CheckoutRecord["buyer"],
    fulfillment: (r.fulfillment ?? null) as CheckoutRecord["fulfillment"],
    totals: (Array.isArray(r.totals) ? r.totals : []) as unknown as CheckoutRecord["totals"],
    currency: r.currency,
    total_minor: r.total_minor,
    connector_state: (r.connector_state ?? {}) as Record<string, unknown>,
    payment: (r.payment ?? {}) as CheckoutPaymentRecord,
    continue_url: r.continue_url,
    idempotency_key: r.idempotency_key,
    agent_profile: r.agent_profile,
    messages: (Array.isArray(r.messages) ? r.messages : []) as unknown as CheckoutRecord["messages"],
    error: (r.error ?? null) as CheckoutRecord["error"],
    expires_at: isoOrNull(r.expires_at),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

/** Only the keys present in the patch, jsonb fields cast to Json. */
function checkoutColumns(p: Partial<NewCheckout>): TablesUpdate<"checkouts"> {
  const c: TablesUpdate<"checkouts"> = {};
  if (p.store_id !== undefined) c.store_id = p.store_id;
  if (p.connector !== undefined) c.connector = p.connector;
  if (p.state !== undefined) c.state = p.state;
  if (p.line_items !== undefined) c.line_items = asJson(p.line_items);
  if (p.buyer !== undefined) c.buyer = asJson(p.buyer);
  if (p.fulfillment !== undefined) c.fulfillment = asJson(p.fulfillment);
  if (p.totals !== undefined) c.totals = asJson(p.totals);
  if (p.currency !== undefined) c.currency = p.currency;
  if (p.total_minor !== undefined) c.total_minor = p.total_minor;
  if (p.connector_state !== undefined) c.connector_state = asJson(p.connector_state);
  if (p.payment !== undefined) c.payment = asJson(p.payment);
  if (p.continue_url !== undefined) c.continue_url = p.continue_url;
  if (p.idempotency_key !== undefined) c.idempotency_key = p.idempotency_key;
  if (p.agent_profile !== undefined) c.agent_profile = p.agent_profile;
  if (p.messages !== undefined) c.messages = asJson(p.messages);
  if (p.error !== undefined) c.error = asJson(p.error);
  if (p.expires_at !== undefined) c.expires_at = p.expires_at;
  return c;
}

export async function insertCheckout(row: NewCheckout): Promise<CheckoutRecord> {
  const cols = checkoutColumns(row);
  const { data, error } = await db()
    .from("checkouts")
    .insert({ ...cols, store_id: row.store_id, connector: row.connector, line_items: asJson(row.line_items) })
    .select("*")
    .single();
  if (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("conflict", "Checkout with this idempotency key already exists", {
        idempotency_key: row.idempotency_key,
      });
    }
    throw toAppError(error);
  }
  return toCheckoutRecord(data);
}

export async function getCheckoutRecord(id: string): Promise<CheckoutRecord | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await db().from("checkouts").select("*").eq("id", id).maybeSingle();
  if (error) {
    if (isMalformed(error)) return null;
    throw toAppError(error);
  }
  return data ? toCheckoutRecord(data) : null;
}

export async function getCheckoutByIdempotencyKey(key: string): Promise<CheckoutRecord | null> {
  const { data, error } = await db().from("checkouts").select("*").eq("idempotency_key", key).maybeSingle();
  if (error) throw toAppError(error);
  return data ? toCheckoutRecord(data) : null;
}

/** Optimistic concurrency: when expectState is given, updates only if the row is still in that state; returns null otherwise. */
export async function updateCheckoutRecord(
  id: string,
  patch: Partial<NewCheckout>,
  opts?: { expectState?: CheckoutState },
): Promise<CheckoutRecord | null> {
  if (!isUuid(id)) return null;
  const cols = checkoutColumns(patch);
  if (Object.keys(cols).length === 0) {
    const current = await getCheckoutRecord(id);
    if (!current) return null;
    return opts?.expectState && current.state !== opts.expectState ? null : current;
  }
  let q = db().from("checkouts").update(cols).eq("id", id);
  if (opts?.expectState) q = q.eq("state", opts.expectState);
  const { data, error } = await q.select("*").maybeSingle();
  if (error) throw toAppError(error);
  return data ? toCheckoutRecord(data) : null;
}

export async function insertCheckoutEvent(ev: Omit<CheckoutEvent, "id" | "created_at">): Promise<CheckoutEvent> {
  const { data, error } = await db()
    .from("checkout_events")
    .insert({
      checkout_id: ev.checkout_id,
      from_state: ev.from_state,
      to_state: ev.to_state,
      message: ev.message,
      data: asJson(ev.data ?? {}),
    })
    .select("*")
    .single();
  if (error) throw toAppError(error);
  return toCheckoutEvent(data);
}

export async function listCheckoutEvents(checkoutId: string): Promise<CheckoutEvent[]> {
  if (!isUuid(checkoutId)) return [];
  const { data, error } = await db()
    .from("checkout_events")
    .select("*")
    .eq("checkout_id", checkoutId)
    .order("id", { ascending: true });
  if (error) throw toAppError(error);
  return (data ?? []).map(toCheckoutEvent);
}

export async function insertOrder(o: Omit<Order, "id" | "created_at">): Promise<Order> {
  const { data, error } = await db()
    .from("orders")
    .insert({
      checkout_id: o.checkout_id,
      store_id: o.store_id,
      status: o.status,
      merchant_order_id: o.merchant_order_id,
      merchant_order_url: o.merchant_order_url,
      rail: o.payment.rail,
      payment_reference: o.payment.reference,
      payer: o.payment.payer ?? null,
      amount_minor: o.payment.amount.amount,
      currency: o.payment.amount.currency,
    })
    .select("*")
    .single();
  if (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("conflict", "An order already exists for this checkout", { checkout_id: o.checkout_id });
    }
    throw toAppError(error);
  }
  return toOrder(data);
}

export async function getOrder(id: string): Promise<Order | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await db().from("orders").select("*").eq("id", id).maybeSingle();
  if (error) {
    if (isMalformed(error)) return null;
    throw toAppError(error);
  }
  return data ? toOrder(data) : null;
}

export async function getOrderByCheckoutId(checkoutId: string): Promise<Order | null> {
  if (!isUuid(checkoutId)) return null;
  const { data, error } = await db().from("orders").select("*").eq("checkout_id", checkoutId).maybeSingle();
  if (error) {
    if (isMalformed(error)) return null;
    throw toAppError(error);
  }
  return data ? toOrder(data) : null;
}

export async function updateOrderStatus(id: string, status: Order["status"]): Promise<Order> {
  const { data, error } = await db().from("orders").update({ status }).eq("id", id).select("*").maybeSingle();
  if (error) throw toAppError(error);
  if (!data) throw new AppError("not_found", "Order not found", { id });
  return toOrder(data);
}
