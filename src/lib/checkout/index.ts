// src/lib/checkout/index.ts  → WS4 (replace bodies, keep names + types)
// STUB created by WS1 at T+30. Owned by WS4 from then on: replace bodies, keep signatures.
import "server-only";
import type { CheckoutService } from "@/lib/contracts";
import { AppError } from "@/lib/errors";

const notYet = (what: string) => new AppError("not_implemented", `${what} is not implemented yet`);

export const createCheckout: CheckoutService["createCheckout"] = async () => { throw notYet("createCheckout"); };
export const updateCheckout: CheckoutService["updateCheckout"] = async () => { throw notYet("updateCheckout"); };
export const getCheckout: CheckoutService["getCheckout"] = async () => { throw notYet("getCheckout"); };
export const completeCheckout: CheckoutService["completeCheckout"] = async () => { throw notYet("completeCheckout"); };
export const cancelCheckout: CheckoutService["cancelCheckout"] = async () => { throw notYet("cancelCheckout"); };
export const getOrder: CheckoutService["getOrder"] = async () => { throw notYet("getOrder"); };
export const listCheckoutEvents: CheckoutService["listCheckoutEvents"] = async () => { throw notYet("listCheckoutEvents"); };
