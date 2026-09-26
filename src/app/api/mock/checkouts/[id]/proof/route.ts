import { getMockService } from "@/features/checkout/runtime";
import { route } from "@/features/checkout/http";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return route(async () => getMockService().proof((await params).id));
}
