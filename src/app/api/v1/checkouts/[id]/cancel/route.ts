import { getMockService } from "@/features/checkout/runtime";
import { context, route } from "@/features/checkout/http";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return route(async () => getMockService().cancelCheckout((await params).id, context(request)));
}
