import type { IndexedProduct } from "../lib/contracts";
import { formatRange } from "../lib/format";
import { STRATEGY_LABELS } from "../lib/methods";
import { Chip, StatusDot } from "../ui/Chip";
import { External } from "../ui/icons";

const PALETTE = ["#2f6bff", "#11a34a", "#ec835a", "#8b5cf6", "#0ea5e9", "#f5a524"];

export function ProductCard({ product, productJsonUrl }: { product: IndexedProduct; productJsonUrl: string }) {
  const img = product.images[0]?.url ?? null;
  const color = PALETTE[product.seq % PALETTE.length];
  return (
    <li className="flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <div className="relative aspect-square bg-well">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element -- merchant images are hotlinked from arbitrary hosts (spec 05 §4.7)
          <img src={img} alt={product.images[0]?.alt ?? product.title} loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
        ) : (
          <div
            aria-hidden="true"
            className="flex size-full items-center justify-center text-[48px] font-semibold text-white"
            style={{ background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 45%, #000))` }}
          >
            {product.title.slice(0, 1).toUpperCase()}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3.5">
        <h3 className="line-clamp-2 text-[14px] leading-snug font-[560]">{product.title}</h3>
        {product.brand ? <p className="truncate text-[12.5px] text-muted">{product.brand}</p> : null}
        <p className="font-mono text-[14px] font-semibold">{formatRange(product.price_range)}</p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-2">
          <span className="inline-flex items-center gap-1">
            <StatusDot tone={product.available ? "good" : "bad"} />
            {product.available ? "In stock" : "Out of stock"}
          </span>
          <span>{product.variants.length} variant{product.variants.length === 1 ? "" : "s"}</span>
          <Chip tone="muted" className="!text-[12px]">{STRATEGY_LABELS[product.source] ?? product.source}</Chip>
        </p>
        <p className="mt-auto flex gap-3 pt-1 text-[12.5px]">
          <a href={product.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-text hover:underline">
            Store page <External size={11} />
          </a>
          <a href={productJsonUrl} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">JSON</a>
        </p>
      </div>
    </li>
  );
}

export function ProductGrid({ products, total, productsJsonUrl, productUrl }: {
  products: IndexedProduct[]; total: number; productsJsonUrl: string; productUrl: (handle: string) => string;
}) {
  return (
    <div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {products.slice(0, 48).map((p) => (
          <ProductCard key={p.id} product={p} productJsonUrl={productUrl(p.handle)} />
        ))}
      </ul>
      {total > 48 ? (
        <p className="mt-3 text-[14px]">
          <a href={productsJsonUrl} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">
            +{(total - 48).toLocaleString("en-US")} more in products.json ↗
          </a>
        </p>
      ) : null}
    </div>
  );
}
