import { notFound } from "next/navigation";
import CheckoutDemo from "../../demo/checkout/checkout-demo";
import { getMockService } from "@/lib/checkout/runtime";
import { CheckoutError } from "@/lib/checkout/errors";
export const dynamic = "force-dynamic";
export default async function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.SHOPPERZERO_MOCK_ENABLED !== "1") return <CheckoutDemo enabled={false} />;
  const { id } = await params;
  const service = getMockService();
  try {
    const [session, events, proof] = await Promise.all([service.getCheckout(id), service.listCheckoutEvents(id), service.proof(id)]);
    return <CheckoutDemo key={id} enabled initial={{ session, events, proof }} />;
  } catch (error) {
    if (error instanceof CheckoutError && error.status === 404) notFound();
    throw error;
  }
}
