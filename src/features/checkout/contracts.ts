// Shared WS1 contracts, with an explicit simulation marker on mock receipts.
export * from "@/contracts/checkout";
export { PAYMENT_HANDLER_IDS, UCP_VERSION, QUOTE_TTL_SECONDS } from "@/contracts/primitives";
export type { Money, IsoDateTime, PaymentRailId, CheckoutConnectorId } from "@/contracts/primitives";
export type { RequestContext } from "@/contracts/services";
import type { RequestContext } from "@/contracts/services";
import type { CheckoutSession as BaseSession, Order as BaseOrder, CheckoutEvent,
  CreateCheckoutInput, UpdateCheckoutInput, CompleteCheckoutInput } from "@/contracts/checkout";
export interface Order extends BaseOrder { simulated: true }
export interface CheckoutSession extends BaseSession { simulated: true; order?: Order }
export interface CheckoutService {
  createCheckout(input: CreateCheckoutInput, ctx: RequestContext): Promise<CheckoutSession>;
  updateCheckout(id: string, input: UpdateCheckoutInput, ctx: RequestContext): Promise<CheckoutSession>;
  getCheckout(id: string): Promise<CheckoutSession>;
  completeCheckout(id: string, input: CompleteCheckoutInput, ctx: RequestContext): Promise<CheckoutSession>;
  cancelCheckout(id: string, ctx: RequestContext): Promise<CheckoutSession>;
  getOrder(id: string): Promise<Order>;
  listCheckoutEvents(id: string): Promise<CheckoutEvent[]>;
}
