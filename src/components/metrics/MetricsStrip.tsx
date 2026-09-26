import type { UiMetrics } from "./types";
import { elapsed } from "../lib/format";
import { cx } from "../ui/tone";

const SPLIT: { key: "api" | "dom" | "computer_use" | "none"; label: string; cls: string }[] = [
  { key: "api", label: "API", cls: "bg-good" },
  { key: "dom", label: "DOM", cls: "bg-warn" },
  { key: "computer_use", label: "Computer use", cls: "bg-serious" },
  { key: "none", label: "None", cls: "bg-bad" },
];

function Tile({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0 border-line px-5 py-4 [&:not(:first-child)]:border-t sm:[&:not(:first-child)]:border-t-0 sm:[&:nth-child(2n)]:border-l lg:[&:not(:first-child)]:border-l">
      <div className="eyebrow">{label}</div>
      <div className="mt-1 font-mono text-[32px] leading-tight font-semibold tabular-nums">{children}</div>
      {sub ? <div className="mt-1 text-[12.5px] text-muted">{sub}</div> : null}
    </div>
  );
}

/** Server component. `metrics === null` renders the muted "Metrics unavailable" line. */
export function MetricsStrip({ metrics }: { metrics: UiMetrics | null }) {
  if (!metrics) return <p className="text-[13px] text-muted">Metrics unavailable</p>;
  const split = metrics.stores_by_best_method ?? {};
  const splitTotal = SPLIT.reduce((n, s) => n + (split[s.key] ?? 0), 0);
  const rails = metrics.orders_by_rail ?? {};
  return (
    <div className="grid overflow-hidden rounded-card border border-line bg-surface shadow-card sm:grid-cols-2 lg:grid-cols-4">
      <Tile
        label="Stores scanned"
        sub={
          splitTotal > 0 ? (
            <>
              <div className="mt-1 flex h-2 w-full overflow-hidden rounded-full bg-well" aria-hidden="true">
                {SPLIT.map((s) => (split[s.key] ? (
                  <div key={s.key} className={cx("h-full", s.cls)} style={{ width: `${(100 * split[s.key]!) / splitTotal}%` }} />
                ) : null))}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-2">
                {SPLIT.map((s) => (
                  <span key={s.key} className="inline-flex items-center gap-1">
                    <span aria-hidden="true" className={cx("inline-block size-2 rounded-full", s.cls)} />
                    {s.label} {split[s.key] ?? 0}
                  </span>
                ))}
              </div>
            </>
          ) : undefined
        }
      >
        {metrics.stores_total.toLocaleString("en-US")}
      </Tile>
      <Tile label="Products normalized">{metrics.products.toLocaleString("en-US")}</Tile>
      <Tile label="Time to agent-ready" sub="median, CTA → live products.json">
        {metrics.median_seconds_to_ready != null ? elapsed(metrics.median_seconds_to_ready * 1000) : "—"}
      </Tile>
      <Tile label="Agent checkouts" sub={`Stripe ${rails.stripe_spt ?? 0} · x402 ${rails.x402 ?? 0}`}>
        {metrics.orders.toLocaleString("en-US")}
      </Tile>
    </div>
  );
}
