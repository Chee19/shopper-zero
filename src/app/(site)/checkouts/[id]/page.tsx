import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckoutTimeline } from "@/components/checkout/CheckoutTimeline";
import { redactCheckout } from "@/components/checkout/redact";
import { shortId } from "@/components/lib/format";
import { getCheckoutView } from "../../_lib/queries";

export async function generateMetadata(props: PageProps<"/checkouts/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  return { title: `Checkout ${shortId(id)} · ShoperZero` };
}

export default async function CheckoutPage(props: PageProps<"/checkouts/[id]">) {
  const { id } = await props.params;
  const view = await getCheckoutView(id);
  if (!view || (!view.checkout && view.events.length === 0)) notFound();
  return (
    <CheckoutTimeline
      checkoutId={id}
      initialCheckout={redactCheckout(view.checkout)}
      initialEvents={view.events}
      replay={null}
      recordedAt={null}
      summaryUnavailable={!view.checkout}
    />
  );
}
