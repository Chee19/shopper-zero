import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClaimFlow } from "@/components/claim/ClaimFlow";
import { getStoreBySlug } from "../../_lib/queries";

export async function generateMetadata(props: PageProps<"/claim/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  return { title: `Claim ${slug} · ShoperZero` };
}

export default async function ClaimPage(props: PageProps<"/claim/[slug]">) {
  const { slug } = await props.params;
  const store = await getStoreBySlug(slug);
  if (!store) notFound();
  return (
    <div className="mx-auto flex max-w-[980px] flex-col gap-5 px-5 py-10 md:px-7">
      <header>
        <p className="eyebrow">Merchant claim</p>
        <h1 className="mt-2 text-[28px] font-semibold tracking-tight">
          Claim {store.name ?? store.domain} <span className="font-normal text-muted">({store.domain})</span>
        </h1>
        <p className="mt-2 max-w-[720px] text-ink-2">
          Prove you control this domain: verified badge, opt-out control, and (soon) native checkout and your own
          /.well-known/ucp.
        </p>
      </header>
      <ClaimFlow slug={store.slug} domain={store.domain} storeHref={`/stores/${store.slug}`} />
    </div>
  );
}
