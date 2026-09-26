import { randomUUID } from "node:crypto";
import type { Ledger, MerchantOrder, PaymentRecord } from "@/features/checkout/storage/file-repository";
import type { CheckoutSession } from "@/features/checkout/contracts";

/** Models Woo order placement entirely inside the transaction; never contacts a merchant. */
export class MockWoo {
  placeOrder(ledger: Ledger, checkout: CheckoutSession, payment: PaymentRecord, fail = false, priceOverrides: Record<string, number> = {}): MerchantOrder | null {
    const existing = Object.values(ledger.merchantOrders).find(o => o.checkout_id === checkout.id);
    if (existing) return existing;
    ledger.vendorCalls.push({ vendor: "woo", operation: "place_order", checkout_id: checkout.id, simulated: true });
    if (fail) return null;
    for (const line of checkout.line_items) {
      const product = ledger.products[line.variant_id];
      if (!product?.allowlisted || product.stock < line.quantity || (priceOverrides[product.id] ?? product.price) !== line.unit_price.amount) return null;
    }
    const order: MerchantOrder = { id: `woo_mock_${randomUUID()}`, checkout_id: checkout.id,
      payment_reference: payment.reference, status: "placed", simulated: true };
    ledger.merchantOrders[order.id] = order;
    for (const line of checkout.line_items) ledger.products[line.variant_id].stock -= line.quantity;
    return order;
  }
  cancelOrder(ledger: Ledger, checkout: CheckoutSession, order: MerchantOrder) {
    if (order.status === "canceled") return;
    ledger.vendorCalls.push({ vendor: "woo", operation: "cancel_order", checkout_id: checkout.id, simulated: true });
    order.status = "canceled";
    for (const line of checkout.line_items) ledger.products[line.variant_id].stock += line.quantity;
  }
}
