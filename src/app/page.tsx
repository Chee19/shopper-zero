import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/metrics/AutoRefresh";
import { MetricsStrip } from "@/components/metrics/MetricsStrip";
import { ScanForm } from "@/components/scan/ScanForm";
import { ago, formatSeconds, formatUsd } from "@/components/lib/format";
import { METHOD_META, METHOD_ORDER, PLATFORM_LABELS, TYPICAL_COST, methodLabel } from "@/components/lib/methods";
import { Chip } from "@/components/ui/Chip";
import { GradeTile } from "@/components/ui/GradeTile";
import { ArrowRight } from "@/components/ui/icons";
import { demoPresets } from "./(site)/_lib/demo";
import { getUiMetrics } from "./(site)/_lib/metrics";
import { getRecentStores, serverNow } from "./(site)/_lib/queries";

export const metadata: Metadata = {
  title: "Agent Readiness Score · ShoperZero",
  description: "Paste a store URL and see whether an AI assistant can shop it: API, web scraping or computer use, with the cost per agent task.",
};

export default async function Home() {
  const [metrics, recent] = await Promise.all([getUiMetrics(), getRecentStores(6)]);
  const now = serverNow();
  const presets = demoPresets(process.env.WOO_DEMO_URL);

  return (
    <div className="relative overflow-hidden">
      <div aria-hidden="true" className="hero-beam" />
      <div className="relative mx-auto max-w-[1240px] px-5 pt-16 pb-8 md:px-7 md:pt-24">
        <div className="mx-auto flex max-w-[860px] flex-col items-center text-center">
          <Chip tone="accent" dot>Agent Readiness Score · free</Chip>
          <h1 className="mt-5 text-[clamp(40px,6vw,72px)] leading-[1.02] font-[650] tracking-[-0.045em]">
            Can an AI assistant{" "}
            <span className="font-display font-normal tracking-[-0.02em] italic">shop your store?</span>
          </h1>
          <p className="mt-5 max-w-[680px] text-[17px] text-ink-2">
            Paste a store URL. Our discovery agent tries what a real assistant would: an API first, then reading the page,
            then clicking through screenshots. You get a grade, the cost per agent task, and a one-click fix: we host UCP,
            MCP, products.json and llms.txt for you.
          </p>
          <div className="mt-8 w-full max-w-[760px] text-left">
            <ScanForm presets={presets} autoFocus />
          </div>
        </div>

        <section aria-labelledby="how" className="mt-20">
          <h2 id="how" className="eyebrow mb-3">How we score</h2>
          <ol className="grid grid-cols-1 items-stretch gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:gap-3">
            {METHOD_ORDER.map((m, i) => (
              <li key={m} className="contents">
                {i > 0 ? (
                  <div aria-hidden="true" className="flex items-center justify-center gap-1 text-muted lg:flex-col">
                    <span className="text-[11.5px] uppercase tracking-[.08em]">if it fails</span>
                    <ArrowRight size={16} className="rotate-90 lg:rotate-0" />
                  </div>
                ) : null}
                <div className="rounded-card border border-line bg-surface px-5 py-4 shadow-card">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12px] text-muted">{i + 1}</span>
                    <span className="font-semibold">{METHOD_META[m].label}</span>
                    <Chip tone={m === "api" ? "good" : m === "dom" ? "warn" : "serious"} className="ml-auto">
                      {METHOD_META[m].band} band
                    </Chip>
                  </div>
                  <p className="mt-2 text-[13.5px] text-ink-2">{METHOD_META[m].blurb}</p>
                  <p className="mt-3 font-mono text-[12.5px]">
                    {formatSeconds(TYPICAL_COST[m].s)} · {formatUsd(TYPICAL_COST[m].usd)} per task
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-label="Metrics" className="mt-12">
          <MetricsStrip metrics={metrics} />
          <AutoRefresh />
        </section>

        {recent.length > 0 ? (
          <section aria-labelledby="recent" className="mt-12">
            <h2 id="recent" className="eyebrow mb-3">Recently scanned</h2>
            <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
              {recent.map((s) => (
                <li key={s.id}>
                  <Link href={`/stores/${s.slug}`} className="flex items-center gap-3 px-5 py-3 hover:bg-well">
                    <span className="flex shrink-0 items-center gap-1">
                      <GradeTile grade={s.grade_before} size="sm" label={`Before: ${s.grade_before ?? "not graded"}`} />
                      {s.grade_after ? (
                        <>
                          <ArrowRight size={12} className="text-muted" />
                          <GradeTile grade={s.grade_after} size="sm" label={`After: ${s.grade_after}`} />
                        </>
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[14px]">
                      <span className="font-[560]">{s.domain}</span>
                      <span className="text-muted">
                        {" "}· {PLATFORM_LABELS[s.platform] ?? s.platform}
                        {s.best_method === "none" ? " · no agent access" : s.best_method ? ` · via ${methodLabel(s.best_method)}` : ""} · {ago(s.updated_at, now)}
                      </span>
                    </span>
                    <ArrowRight size={16} className="shrink-0 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
