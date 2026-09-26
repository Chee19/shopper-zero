import "server-only";
import { resolve } from "node:path";
import { FileCheckoutRepository } from "./repo";
import { createCheckoutService } from "./service";
import { CheckoutError } from "./errors";

export function getMockService() {
  if (process.env.SHOPPERZERO_MOCK_ENABLED !== "1") {
    throw new CheckoutError("mock_disabled", "Start with npm run dev:mock to enable the simulated checkout demo.", 503);
  }
  return createCheckoutService(new FileCheckoutRepository(resolve(process.env.MOCK_CHECKOUT_DATA_FILE ?? ".mock-checkout/ledger.json")), {
    appUrl: process.env.MOCK_CHECKOUT_APP_URL ?? "http://localhost:3000",
  });
}
