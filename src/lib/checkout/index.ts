import { getMockService } from "./runtime";
import type { CheckoutService } from "./contracts";
export const checkoutService: CheckoutService = {
  createCheckout: (...args) => getMockService().createCheckout(...args),
  updateCheckout: (...args) => getMockService().updateCheckout(...args),
  getCheckout: (...args) => getMockService().getCheckout(...args),
  completeCheckout: (...args) => getMockService().completeCheckout(...args),
  cancelCheckout: (...args) => getMockService().cancelCheckout(...args),
  getOrder: (...args) => getMockService().getOrder(...args),
  listCheckoutEvents: (...args) => getMockService().listCheckoutEvents(...args),
};
export const { createCheckout, updateCheckout, getCheckout, completeCheckout, cancelCheckout, getOrder, listCheckoutEvents } = checkoutService;
