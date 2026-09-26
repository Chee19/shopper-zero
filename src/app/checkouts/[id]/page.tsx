import { notFound } from "next/navigation";
import CheckoutDemo from "@/features/checkout/components/checkout-demo";
import { getMockService } from "@/features/checkout/runtime";
import { CheckoutError } from "@/features/checkout/errors";
export const dynamic = "force-dynamic";
export default async function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.SHOPPERZERO_MOCK_ENABLED !== "1") return <CheckoutDemo enabled={false} />;
  const { id } = await params;
  const service = getMockService();
  const initial = await Promise.all([service.getCheckout(id), service.listCheckoutEvents(id), service.proof(id)]).catch(error => {
    if (error instanceof CheckoutError && error.status === 404) notFound();
    throw error;
  });
  return <CheckoutDemo key={id} enabled initial={{ session: initial[0], events: initial[1], proof: initial[2] }} />;
}
