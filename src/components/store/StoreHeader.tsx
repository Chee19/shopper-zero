import Link from "next/link";
import type { AccessMethod, Store } from "../lib/contracts";
import { ago } from "../lib/format";
import { PLATFORM_LABELS, methodLabel } from "../lib/methods";
import { Chip } from "../ui/Chip";
import { Check, External } from "../ui/icons";

export function StoreHeader({ store, method, now }: { store: Store; method: AccessMethod | "none" | null; now: number }) {
  return (
    <div className="flex flex-col gap-2">
      <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
        <Link href="/stores" className="hover:text-ink">← Stores</Link> / <span className="font-mono">{store.slug}</span>
      </nav>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-[28px] font-semibold tracking-tight">{store.name ?? store.domain}</h1>
        <a href={store.base_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[14px] text-ink-2 hover:text-ink">
          {store.domain} <External size={12} />
        </a>
        <Chip tone="muted">{PLATFORM_LABELS[store.platform] ?? store.platform}</Chip>
        {method && method !== "none" ? <Chip tone="muted">via {methodLabel(method)}</Chip> : null}
        {store.status === "indexed" ? <span className="text-[14px] text-ink-2">{store.product_count.toLocaleString("en-US")} products</span> : null}
        {store.last_crawled_at ? <span className="text-[13px] text-muted">Indexed {ago(store.last_crawled_at, now)}</span> : null}
      </div>
      <div className="text-[14px]">
        {store.claimed ? (
          <span className="inline-flex items-center gap-1.5 text-good-text">
            <Check size={14} /> <span className="font-display text-[17px] italic">Verified merchant</span>
          </span>
        ) : (
          <Link href={`/claim/${store.slug}`} className="text-accent-text hover:underline">Is this your store? Claim it →</Link>
        )}
      </div>
    </div>
  );
}
