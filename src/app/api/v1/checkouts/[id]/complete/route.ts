import { getMockService } from "@/lib/checkout/runtime";
import { body, context, route } from "@/lib/checkout/http";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return route(async () => getMockService().completeCheckout((await params).id, await body(request), context(request)));
}
