import type { Metadata } from "next";
import { CheckoutTimeline } from "@/components/checkout/CheckoutTimeline";
import { redactCheckout } from "@/components/checkout/redact";
import { UI_MOCK } from "../../_lib/env";
import { getCheckoutReplay, getCheckoutView, getLatestCheckoutId } from "../../_lib/queries";

export const metadata: Metadata = { title: "Live checkout · ShoperZero" };

/** Follows the newest checkout; ?replay=spt|handoff plays a recording (the default in UI_MOCK). */
export default async function LiveCheckoutPage(props: PageProps<"/checkouts/live">) {
  const sp = await props.searchParams;
  const replayName = typeof sp.replay === "string" ? sp.replay : UI_MOCK ? "spt" : null;
  const replay = replayName ? getCheckoutReplay(replayName) : null;

  if (replay) {
    return (
      <CheckoutTimeline
        key={`replay-${replayName}`}
        checkoutId={replay.checkout.id}
        initialCheckout={null}
        initialEvents={[]}
        replay={{ checkout: redactCheckout(replay.checkout)!, frames: replay.frames }}
        recordedAt={replay.recorded_at}
        summaryUnavailable={false}
      />
    );
  }

  const latestId = await getLatestCheckoutId();
  const view = latestId ? await getCheckoutView(latestId) : null;
  return (
    <CheckoutTimeline
      key="follow"
      checkoutId="latest"
      initialCheckout={redactCheckout(view?.checkout ?? null)}
      initialEvents={view?.events ?? []}
      replay={null}
      recordedAt={null}
      summaryUnavailable={Boolean(view && !view.checkout)}
    />
  );
}
