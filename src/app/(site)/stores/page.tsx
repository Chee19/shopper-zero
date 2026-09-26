import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/metrics/AutoRefresh";
import { MetricsStrip } from "@/components/metrics/MetricsStrip";
import { ago } from "@/components/lib/format";
import { CONNECTOR_LABELS, PLATFORM_LABELS, methodLabel } from "@/components/lib/methods";
import { GradeTile } from "@/components/ui/GradeTile";
import { EmptyState } from "@/components/ui/States";
import { ButtonLink } from "@/components/ui/Button";
import { Check } from "@/components/ui/icons";
import { getUiMetrics } from "../_lib/metrics";
import { listAllStores, serverNow } from "../_lib/queries";

export const metadata: Metadata = { title: "Stores · ShoperZero" };

export default async function StoresPage() {
  const [metrics, stores] = await Promise.all([getUiMetrics(), listAllStores(50)]);
  const now = serverNow();
  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-5 py-8 md:px-7">
      <h1 className="text-[28px] font-semibold tracking-tight">Stores</h1>
      <MetricsStrip metrics={metrics} />
      <AutoRefresh />
      {!stores || stores.length === 0 ? (
        <EmptyState title={stores ? "No stores yet. Scan one." : "Stores unavailable right now."} action={<ButtonLink href="/">Scan a store</ButtonLink>} />
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
          <table className="w-full min-w-[820px] text-[14px]">
            <thead>
              <tr className="text-left">
                {["Grade", "Store", "Platform", "Best method", "Products", "Checkout", "Verified", "Updated"].map((h) => (
                  <th key={h} className="eyebrow px-4 py-3 font-[560]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stores.map((s) => (
                <tr key={s.id} className="border-t border-line hover:bg-well">
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-1">
                      <GradeTile grade={s.grade_before} size="sm" label={`Before ${s.grade_before ?? "not graded"}`} />
                      {s.grade_after ? <><span className="text-muted">→</span><GradeTile grade={s.grade_after} size="sm" label={`After ${s.grade_after}`} /></> : null}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <Link href={`/stores/${s.slug}`} className="font-[560] hover:underline">{s.name ?? s.domain}</Link>
                    <div className="text-[12.5px] text-muted">{s.domain}{s.opted_out ? " · opted out" : ""}</div>
                  </td>
                  <td className="px-4 py-2.5">{PLATFORM_LABELS[s.platform] ?? s.platform}</td>
                  <td className="px-4 py-2.5">{s.best_method ? methodLabel(s.best_method) : "—"}</td>
                  <td className="px-4 py-2.5 font-mono">{s.product_count.toLocaleString("en-US")}</td>
                  <td className="px-4 py-2.5">{CONNECTOR_LABELS[s.checkout_connector] ?? s.checkout_connector}</td>
                  <td className="px-4 py-2.5">{s.claimed ? <Check size={15} className="text-good-text" aria-label="Verified" /> : <span className="text-muted">—</span>}</td>
                  <td className="px-4 py-2.5 text-muted">{ago(s.updated_at, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
