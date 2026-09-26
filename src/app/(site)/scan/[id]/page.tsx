import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ScanExperience } from "@/components/scan/ScanExperience";
import { domainOf } from "@/components/lib/format";
import { getScanView } from "../../_lib/queries";

export async function generateMetadata(props: PageProps<"/scan/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const view = await getScanView(id);
  return { title: view ? `${domainOf(view.scan.url)} report · ShoperZero` : "Scan · ShoperZero" };
}

export default async function ScanPage(props: PageProps<"/scan/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const view = await getScanView(id, typeof sp.run === "string" ? sp.run : undefined);
  if (!view) notFound();
  return (
    <ScanExperience
      key={view.scan.id}
      scan={view.scan}
      store={view.store}
      run={view.run}
      replay={view.replay}
      demo={sp.demo === "1"}
      replayStoreHref={view.replayStoreHref}
    />
  );
}
