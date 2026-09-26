import { z } from "zod";
import { getMockService } from "@/features/checkout/runtime";
import { body, context, route } from "@/features/checkout/http";
import { SCENARIOS } from "@/features/checkout/demo/fixtures";
import { CheckoutError } from "@/features/checkout/errors";
export async function POST(request: Request) {
  return route(async () => {
    const service = getMockService();
    const result = z.object({ scenario: z.enum(SCENARIOS), variant_id: z.string().uuid().optional(), quantity: z.number().int().min(1).max(10).optional() }).safeParse(await body(request));
    if (!result.success) throw new CheckoutError("validation_error", "Select a supported demo scenario.");
    return service.createDemoCheckout(result.data.scenario, context(request), result.data);
  }, 201);
}
