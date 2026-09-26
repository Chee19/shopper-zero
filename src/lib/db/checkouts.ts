/* eslint-disable @typescript-eslint/no-unused-vars -- stub parameters, removed with the T+60 bodies */
import "server-only";
import type { CheckoutEvent, CheckoutRecord, CheckoutState, Order } from "@/lib/contracts";
import { AppError } from "@/lib/errors";

export type NewCheckout = Omit<CheckoutRecord, "id" | "created_at" | "updated_at">;

// TODO(WS1 T+60)
export async function insertCheckout(row: NewCheckout): Promise<CheckoutRecord> {
  throw new AppError("not_implemented", "insertCheckout");
}

// TODO(WS1 T+60)
export async function getCheckoutRecord(id: string): Promise<CheckoutRecord | null> {
  throw new AppError("not_implemented", "getCheckoutRecord");
}

// TODO(WS1 T+60)
export async function getCheckoutByIdempotencyKey(key: string): Promise<CheckoutRecord | null> {
  throw new AppError("not_implemented", "getCheckoutByIdempotencyKey");
}

// TODO(WS1 T+60)
/** Optimistic concurrency: when expectState is given, updates only if the row is still in that state; returns null otherwise. */
export async function updateCheckoutRecord(
  id: string,
  patch: Partial<NewCheckout>,
  opts?: { expectState?: CheckoutState },
): Promise<CheckoutRecord | null> {
  throw new AppError("not_implemented", "updateCheckoutRecord");
}

// TODO(WS1 T+60)
export async function insertCheckoutEvent(ev: Omit<CheckoutEvent, "id" | "created_at">): Promise<CheckoutEvent> {
  throw new AppError("not_implemented", "insertCheckoutEvent");
}

// TODO(WS1 T+60)
export async function listCheckoutEvents(checkoutId: string): Promise<CheckoutEvent[]> {
  throw new AppError("not_implemented", "listCheckoutEvents");
}

// TODO(WS1 T+60)
export async function insertOrder(o: Omit<Order, "id" | "created_at">): Promise<Order> {
  throw new AppError("not_implemented", "insertOrder");
}

// TODO(WS1 T+60)
export async function getOrder(id: string): Promise<Order | null> {
  throw new AppError("not_implemented", "getOrder");
}

// TODO(WS1 T+60)
export async function getOrderByCheckoutId(checkoutId: string): Promise<Order | null> {
  throw new AppError("not_implemented", "getOrderByCheckoutId");
}

// TODO(WS1 T+60)
export async function updateOrderStatus(id: string, status: Order["status"]): Promise<Order> {
  throw new AppError("not_implemented", "updateOrderStatus");
}
