import { z } from "zod";
import { getMockService } from "@/lib/checkout/runtime";
import { body, context, route } from "@/lib/checkout/http";
import { SCENARIOS } from "@/lib/checkout/fixtures";
import { CheckoutError } from "@/lib/checkout/errors";
export async function POST(request: Request) {
  return route(async () => {
    const service = getMockService();
    const result = z.object({ scenario: z.enum(SCENARIOS) }).safeParse(await body(request));
    if (!result.success) throw new CheckoutError("validation_error", "Select a supported demo scenario.");
    return service.createDemoCheckout(result.data.scenario, context(request));
  }, 201);
}
