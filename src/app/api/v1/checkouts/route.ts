import { getMockService } from "@/lib/checkout/runtime";
import { body, context, route } from "@/lib/checkout/http";
export async function POST(request: Request) {
  return route(async () => getMockService().createCheckout(await body(request), context(request)), 201);
}
