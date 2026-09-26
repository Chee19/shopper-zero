import { randomUUID } from "node:crypto";
import type { Ledger, PaymentRecord } from "../checkout/repo";
import type { CheckoutSession } from "../checkout/contracts";
import { CheckoutError } from "../checkout/errors";

/** Deliberately no Stripe SDK, credentials or fetch: this adapter can only simulate. */
export class MockStripe {
  authorize(ledger: Ledger, checkout: CheckoutSession, token: string): PaymentRecord | "declined" | "requires_action" {
    if (!["mock_card_visa", "mock_card_declined", "mock_card_requires_action"].includes(token)) {
      throw new CheckoutError("validation_error", "Use a mock_card_* demo credential. Real payment credentials are not accepted.");
    }
    const existing = Object.values(ledger.payments).find(p => p.checkout_id === checkout.id);
    if (existing) return existing;
    ledger.vendorCalls.push({ vendor: "stripe", operation: "authorize", checkout_id: checkout.id, simulated: true });
    if (token === "mock_card_declined") return "declined";
    if (token === "mock_card_requires_action") return "requires_action";
    const payment: PaymentRecord = {
      reference: `pi_mock_${randomUUID()}`, checkout_id: checkout.id,
      amount: checkout.totals.find(t => t.type === "total")!.amount, currency: checkout.currency,
      status: "authorized", simulated: true,
    };
    ledger.payments[payment.reference] = payment;
    return payment;
  }
  capture(ledger: Ledger, payment: PaymentRecord, fail = false): boolean {
    if (payment.status === "captured") return true;
    if (payment.status !== "authorized") throw new Error("Cannot capture a voided mock authorization");
    ledger.vendorCalls.push({ vendor: "stripe", operation: "capture", checkout_id: payment.checkout_id, simulated: true });
    if (fail) return false;
    payment.status = "captured";
    return true;
  }
  voidOrRefund(ledger: Ledger, payment: PaymentRecord): void {
    if (payment.status === "voided") return;
    ledger.vendorCalls.push({ vendor: "stripe", operation: "void", checkout_id: payment.checkout_id, simulated: true });
    payment.status = "voided";
  }
}
