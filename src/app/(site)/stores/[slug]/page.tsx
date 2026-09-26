import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentSurfaces } from "@/components/store/AgentSurfaces";
import { ConnectAgent } from "@/components/store/ConnectAgent";
import { GradeHero } from "@/components/store/GradeHero";
import { ProductGrid } from "@/components/store/ProductGrid";
import { RescanButton } from "@/components/store/RescanButton";
import { StoreHeader } from "@/components/store/StoreHeader";
import { Card } from "@/components/ui/Card";
import { Banner, EmptyState } from "@/components/ui/States";
import { ButtonLink } from "@/components/ui/Button";
import { appUrl } from "../../_lib/env";
import { getStoreView, serverNow } from "../../_lib/queries";

export async function generateMetadata(props: PageProps<"/stores/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  return { title: `${slug} · ShoperZero` };
}

export default async function StorePage(props: PageProps<"/stores/[slug]">) {
  const { slug } = await props.params;
  const sp = await props.searchParams;
  const fromScan = typeof sp.from_scan === "string" ? sp.from_scan : undefined;
  const view = await getStoreView(slug, fromScan);
  if (!view) notFound();
  const { store, products, total, scan, latestRun } = view;
  const now = serverNow();
  const base = appUrl();

  const beforeReport = store.readiness.before;
  const before = scan ? { grade: scan.grade, score: scan.score } : beforeReport ? { grade: beforeReport.grade, score: beforeReport.score } : null;
  const afterReport = store.readiness.after;
  const after = afterReport ? { grade: afterReport.grade, score: afterReport.score } : null;
  const method = scan?.best_method ?? store.best_method;
  const indexingHref =
    store.latest_scan_id && latestRun ? `/scan/${store.latest_scan_id}?run=${latestRun.id}` : store.latest_scan_id ? `/scan/${store.latest_scan_id}` : "/";

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-5 px-5 py-8 md:px-7">
      <StoreHeader store={store} method={method} now={now} />

      <Card className="flex flex-col gap-4 px-5 py-5 md:flex-row md:items-center md:justify-between md:px-7">
        <GradeHero before={before} after={after} method={method} animate={Boolean(fromScan && before && after)} />
        <RescanButton url={store.base_url} replayId={store.latest_scan_id} />
      </Card>

      {store.opted_out ? (
        <Banner tone="warn"><p className="font-[560]">The merchant opted this store out.</p></Banner>
      ) : (
        <>
          {store.status === "crawling" ? (
            <Banner tone="accent">
              Indexing now… <Link href={indexingHref} className="ml-1 text-accent-text hover:underline">Watch progress →</Link>
            </Banner>
          ) : null}
          {store.status === "blocked" ? (
            <Banner tone="warn">
              This store challenged our crawler. We don&apos;t bypass bot protection. The merchant can claim it to opt in.
              <Link href={`/claim/${store.slug}`} className="ml-2 text-accent-text hover:underline">Claim this store →</Link>
            </Banner>
          ) : null}
          {store.status === "failed" ? (
            <Banner tone="bad">The last indexing run failed. Re-scan to try again.</Banner>
          ) : null}

          <AgentSurfaces store={store} />
          <ConnectAgent appUrl={base} />

          <section aria-labelledby="products">
            <h2 id="products" className="eyebrow mb-3">Products</h2>
            {products.length > 0 ? (
              <ProductGrid
                products={products}
                total={total}
                productsJsonUrl={store.urls.products_json}
                productUrl={(h) => `${base}/s/${store.slug}/products/${h}.json`}
              />
            ) : (
              <EmptyState
                title={store.status === "indexed" ? "No products indexed yet" : "No products yet"}
                action={<ButtonLink href="/" variant="secondary">Scan a store</ButtonLink>}
              >
                {store.status === "pending" && store.best_method === "computer_use"
                  ? "This store is reachable by computer use only, so there is no catalog to index. The merchant can claim it to connect a feed."
                  : "Once indexing finishes, products appear here and in products.json."}
              </EmptyState>
            )}
          </section>
        </>
      )}
    </div>
  );
}
