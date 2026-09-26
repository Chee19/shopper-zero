import type { CheckoutEvent, CheckoutState } from "../lib/contracts";
import { Check, X } from "../ui/icons";
import { cx } from "../ui/tone";

const HAPPY: { state: CheckoutState; label: string }[] = [
  { state: "quoting", label: "Quote from merchant" },
  { state: "awaiting_payment", label: "Ready for payment" },
  { state: "payment_authorized", label: "Payment authorized" },
  { state: "placing_order", label: "Placing order on merchant" },
  { state: "order_placed", label: "Order placed" },
  { state: "completed", label: "Captured and complete" },
];
const BAD_TERMINAL: CheckoutState[] = ["refunding", "failed", "expired", "canceled"];

export function StateRail({ events, current }: { events: CheckoutEvent[]; current: CheckoutState | null }) {
  const reached = new Set(events.map((e) => e.to_state));
  const sawAction = reached.has("requires_action");
  return (
    <ol className="flex flex-col gap-2.5" aria-label="Checkout state">
      {HAPPY.map((h) => {
        const done = reached.has(h.state) && (h.state !== current || current === "completed");
        const isCurrent = h.state === current && current !== "completed";
        return (
          <li key={h.state} className="flex items-center gap-2 text-[13.5px]">
            <span
              aria-hidden="true"
              className={cx(
                "inline-flex size-5 shrink-0 items-center justify-center rounded-full",
                done ? "bg-good text-page"
                  : isCurrent ? "shimmer-bar animate-shimmer" : "bg-grid",
              )}
            >
              {done ? <Check size={12} strokeWidth={3} /> : null}
            </span>
            <span className={cx(done || isCurrent ? "text-ink" : "text-muted", isCurrent && "font-[560]")}>{h.label}</span>
            <span className="sr-only">{done ? "reached" : isCurrent ? "current" : "not reached"}</span>
            {h.state === "awaiting_payment" && sawAction ? (
              <span className="ml-auto rounded-md bg-warn/14 px-1.5 text-[11.5px] text-warn-text">requires action</span>
            ) : null}
          </li>
        );
      })}
      {current === "handoff" ? (
        <li className="mt-1 flex items-center gap-2 rounded-lg bg-warn/14 px-2 py-1.5 text-[13.5px] text-warn-text">
          <span aria-hidden="true" className="inline-block size-2 rounded-full bg-warn" /> Handed off to merchant checkout
        </li>
      ) : null}
      {current && BAD_TERMINAL.includes(current) ? (
        <li className="mt-1 flex items-center gap-2 rounded-lg bg-bad/13 px-2 py-1.5 text-[13.5px] text-bad-text">
          <X size={13} /> {current}
        </li>
      ) : null}
    </ol>
  );
}
