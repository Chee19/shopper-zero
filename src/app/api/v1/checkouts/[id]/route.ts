import { getMockService } from "@/features/checkout/runtime";
import { body, context, route } from "@/features/checkout/http";
type Params = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Params) {
  return route(async () => getMockService().getCheckout((await params).id));
}
export async function PUT(request: Request, { params }: Params) {
  return route(async () => getMockService().updateCheckout((await params).id, await body(request), context(request)));
}
