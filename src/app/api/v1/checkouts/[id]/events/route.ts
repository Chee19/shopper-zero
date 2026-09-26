import { getMockService } from "@/lib/checkout/runtime";
import { route } from "@/lib/checkout/http";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return route(async () => ({ events: await getMockService().listCheckoutEvents((await params).id) }));
}
