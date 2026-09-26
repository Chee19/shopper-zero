import type { CheckoutEventData, PaymentRailId } from "../lib/contracts";
import { explorerUrl, formatMoney, stripeUrl, truncateMiddle } from "../lib/format";
import { Chip } from "../ui/Chip";
import { CopyButton } from "../ui/CopyButton";
import { External } from "../ui/icons";

export const RAIL_LABEL: Record<PaymentRailId, string> = { stripe_spt: "Stripe SPT", x402: "x402" };

const link = "inline-flex items-center gap-1 text-accent-text hover:underline";

/** Renders the CCR-5 event data keys (spec 04 §6.4) as chips and links. */
export function PaymentLinks({ data }: { data: CheckoutEventData & { explorer_url?: string } }) {
  if (!data || Object.keys(data).length === 0) return null;
  const tx = explorerUrl(data);
  const network = data.network === "eip155:8453" ? "Base" : "Base Sepolia";
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
      {data.rail ? <Chip tone="accent">{RAIL_LABEL[data.rail] ?? data.rail}</Chip> : null}
      {data.amount ? <span className="font-mono">{formatMoney(data.amount)}</span> : null}
      {data.payment_intent_id ? (
        <span className="inline-flex items-center">
          <a href={stripeUrl(data.payment_intent_id)} target="_blank" rel="noreferrer" className={link}>
            PaymentIntent <code className="font-mono text-[12px]">{truncateMiddle(data.payment_intent_id, 8, 4)}</code> <External size={11} />
          </a>
          <CopyButton text={data.payment_intent_id} />
        </span>
      ) : null}
      {data.tx_hash && tx ? (
        <a href={tx} target="_blank" rel="noreferrer" className={link}>
          {network} tx <code className="font-mono text-[12px]">{truncateMiddle(data.tx_hash, 4, 2)}</code> <External size={11} />
        </a>
      ) : null}
      {data.merchant_order_url ? (
        <a href={data.merchant_order_url} target="_blank" rel="noreferrer" className={link}>
          WooCommerce order #{data.merchant_order_id ?? "…"} <External size={11} />
        </a>
      ) : data.merchant_order_id ? (
        <span>Merchant order #{data.merchant_order_id}</span>
      ) : null}
      {data.continue_url ? (
        <a href={data.continue_url} target="_blank" rel="noreferrer" className={link}>Open prefilled cart <External size={11} /></a>
      ) : null}
      {data.simulated ? <Chip tone="muted">simulated</Chip> : null}
      {data.error_code ? <Chip tone="bad" mono>{data.error_code}</Chip> : null}
    </div>
  );
}
