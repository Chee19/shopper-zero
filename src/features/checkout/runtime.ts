import "server-only";
import { resolve } from "node:path";
import { FileCheckoutRepository } from "@/features/checkout/storage/file-repository";
import { createCheckoutService } from "@/features/checkout/service";
import { createProvenceService } from "./provence-service";
import { CheckoutError } from "@/features/checkout/errors";

export function getMockService() {
  if (process.env.SHOPPERZERO_MOCK_ENABLED !== "1") {
    throw new CheckoutError("mock_disabled", "Start with npm run dev:mock to enable the simulated checkout demo.", 503);
  }
  const repository = new FileCheckoutRepository(resolve(/* turbopackIgnore: true */ process.env.MOCK_CHECKOUT_DATA_FILE ?? ".mock-checkout/ledger.json"));
  const options = {
    appUrl: process.env.MOCK_CHECKOUT_APP_URL ?? "http://localhost:3000",
  };
  return process.env.CHECKOUT_DEMO_STORE === "fixtures" ? createCheckoutService(repository, options) : createProvenceService(repository, { ...options, origin: process.env.PROVENCE_STORE_URL ?? "http://127.0.0.1:4002" });
}
